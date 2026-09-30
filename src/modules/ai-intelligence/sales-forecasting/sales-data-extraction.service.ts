/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, Logger } from '@nestjs/common';
import { SaleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import {
  BranchDailyRevenueRow,
  BranchSummaryReport,
  DatasetValidationReport,
  ExtractionOptions,
  RawSaleRow,
} from './interfaces/sales-dataset.interface';

const COLOMBO_TIMEZONE = 'Asia/Colombo';
const REQUIRED_HISTORY_DAYS = 28;

@Injectable()
export class SalesDataExtractionService {
  private readonly logger = new Logger(SalesDataExtractionService.name);
  private readonly colomboFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: COLOMBO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Convert any Date object to YYYY-MM-DD string in Asia/Colombo timezone.
   */
  formatInColombo(date: Date): string {
    return this.colomboFormatter.format(date);
  }

  /**
   * Safely convert Prisma Decimal, string, or number to a rounded numeric float.
   */
  safeDecimalToNumber(value: unknown): number {
    if (value === null || value === undefined) return 0.0;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0.0;
    }
    if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
      const num = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0.0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0.0;
  }

  /**
   * Extract valid historical sales transactions for a given organization.
   *
   * Security & Integrity:
   * - Enforces organization boundary.
   * - Only includes COMPLETED and PARTIALLY_REFUNDED sales.
   * - Uses COALESCE(completedAt, createdAt) for transaction date.
   */
  async extractRawSales(
    organizationId: string,
    options?: ExtractionOptions,
  ): Promise<RawSaleRow[]> {
    const validStatuses: SaleStatus[] = [
      SaleStatus.COMPLETED,
      SaleStatus.PARTIALLY_REFUNDED,
    ];

    const whereClause: Record<string, unknown> = {
      branch: { organizationId },
      status: { in: validStatuses },
    };

    if (options?.branchId) {
      whereClause.branchId = options.branchId;
    }

    if (options?.startDate || options?.endDate) {
      whereClause.createdAt = {
        gte: options.startDate,
        lte: options.endDate,
      };
    }

    const sales = await this.prisma.sale.findMany({
      where: whereClause,
      select: {
        id: true,
        branchId: true,
        status: true,
        total: true,
        completedAt: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            code: true,
            name: true,
            organizationId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return sales.map((sale) => {
      const transactionDate = sale.completedAt ?? sale.createdAt;
      return {
        id: sale.id,
        organizationId: sale.branch.organizationId,
        branchId: sale.branchId,
        branchCode: sale.branch.code,
        branchName: sale.branch.name,
        status: sale.status,
        total: this.safeDecimalToNumber(sale.total),
        completedAt: sale.completedAt,
        createdAt: sale.createdAt,
        transactionDate,
        dateStr: this.formatInColombo(transactionDate),
      };
    });
  }

  /**
   * Aggregate raw sale rows into daily buckets per branch:
   * Branch ID -> Date (YYYY-MM-DD) -> { revenue, transactionCount }
   */
  aggregateSalesByDate(
    sales: RawSaleRow[],
  ): Map<string, Map<string, { revenue: number; count: number }>> {
    const branchMap = new Map<
      string,
      Map<string, { revenue: number; count: number }>
    >();

    for (const sale of sales) {
      let dateMap = branchMap.get(sale.branchId);
      if (!dateMap) {
        dateMap = new Map<string, { revenue: number; count: number }>();
        branchMap.set(sale.branchId, dateMap);
      }

      const existing = dateMap.get(sale.dateStr) ?? { revenue: 0.0, count: 0 };
      existing.revenue = Math.round((existing.revenue + sale.total) * 100) / 100;
      existing.count += 1;
      dateMap.set(sale.dateStr, existing);
    }

    return branchMap;
  }

  /**
   * Build a complete Branch x Date calendar for a branch across its observed lifecycle.
   *
   * Missing-Day Semantics:
   * - Dates prior to first observed sale are strictly PRE-LAUNCH and excluded from calendar.
   * - Dates within [firstSaleDate, lastSaleDate] without sales are tagged 'operating_zero_sales' (daily_revenue = 0.0).
   * - Days of week and weekend indicators are properly computed in Colombo local time.
   */
  buildBranchDailyCalendar(
    branch: { id: string; code: string; name: string; organizationId: string },
    dailyAggregates: Map<string, { revenue: number; count: number }>,
    targetEndDate?: string,
  ): BranchDailyRevenueRow[] {
    const dates = Array.from(dailyAggregates.keys()).sort();
    if (dates.length === 0) {
      return [];
    }

    const firstDateStr = dates[0];
    const lastDateStr = targetEndDate && targetEndDate > dates[dates.length - 1]
      ? targetEndDate
      : dates[dates.length - 1];

    const result: BranchDailyRevenueRow[] = [];
    const currentDate = new Date(`${firstDateStr}T00:00:00+05:30`);
    const endDate = new Date(`${lastDateStr}T00:00:00+05:30`);

    while (currentDate <= endDate) {
      const dateStr = this.formatInColombo(currentDate);
      const agg = dailyAggregates.get(dateStr);

      // Determine day of week in Colombo (0=Monday, 6=Sunday)
      const jsDay = currentDate.getUTCDay();
      const dayOfWeek = (jsDay + 6) % 7;
      const isWeekend = dayOfWeek >= 5 ? 1 : 0;

      if (agg) {
        result.push({
          organization_id: branch.organizationId,
          branch_id: branch.id,
          branch_code: branch.code,
          branch_name: branch.name,
          date: dateStr,
          daily_revenue: agg.revenue,
          transaction_count: agg.count,
          day_of_week: dayOfWeek,
          is_weekend: isWeekend,
          operational_status: 'operating_sales',
          is_operating_day: 1,
        });
      } else {
        result.push({
          organization_id: branch.organizationId,
          branch_id: branch.id,
          branch_code: branch.code,
          branch_name: branch.name,
          date: dateStr,
          daily_revenue: 0.0,
          transaction_count: 0,
          day_of_week: dayOfWeek,
          is_weekend: isWeekend,
          operational_status: 'operating_zero_sales',
          is_operating_day: dayOfWeek === 6 ? 0 : 1, // Sunday default non-operating in standard retail
        });
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return result;
  }

  /**
   * Top-level pipeline: Extracts sales, aggregates by day, and constructs complete Branch x Date matrix.
   */
  async buildDataset(
    organizationId: string,
    options?: ExtractionOptions,
  ): Promise<BranchDailyRevenueRow[]> {
    const rawSales = await this.extractRawSales(organizationId, options);
    if (rawSales.length === 0) {
      return [];
    }

    // Collect branch metadata
    const branchMeta = new Map<
      string,
      { id: string; code: string; name: string; organizationId: string }
    >();
    for (const s of rawSales) {
      if (!branchMeta.has(s.branchId)) {
        branchMeta.set(s.branchId, {
          id: s.branchId,
          code: s.branchCode,
          name: s.branchName,
          organizationId: s.organizationId,
        });
      }
    }

    const aggregated = this.aggregateSalesByDate(rawSales);
    const targetEndDate = options?.endDate
      ? this.formatInColombo(options.endDate)
      : undefined;

    const fullDataset: BranchDailyRevenueRow[] = [];
    for (const [branchId, branchInfo] of branchMeta.entries()) {
      const branchDailyAggs = aggregated.get(branchId) ?? new Map();
      const branchRows = this.buildBranchDailyCalendar(
        branchInfo,
        branchDailyAggs,
        targetEndDate,
      );
      fullDataset.push(...branchRows);
    }

    return fullDataset;
  }

  /**
   * Generate an audit and validation report summarizing dataset properties.
   */
  generateValidationReport(
    dataset: BranchDailyRevenueRow[],
  ): DatasetValidationReport {
    const orgs = new Set<string>();
    const branchMap = new Map<string, BranchDailyRevenueRow[]>();

    for (const row of dataset) {
      orgs.add(row.organization_id);
      let rows = branchMap.get(row.branch_id);
      if (!rows) {
        rows = [];
        branchMap.set(row.branch_id, rows);
      }
      rows.push(row);
    }

    const branchesReport: BranchSummaryReport[] = [];
    let grandTotalRevenue = 0.0;
    let minDailyRevenue = dataset.length > 0 ? Infinity : 0.0;
    let maxDailyRevenue = 0.0;
    let overallStartDate: string | null = null;
    let overallEndDate: string | null = null;
    let insufficientCount = 0;

    for (const [branchId, rows] of branchMap.entries()) {
      rows.sort((a, b) => a.date.localeCompare(b.date));

      const firstDate = rows[0]?.date ?? null;
      const lastDate = rows[rows.length - 1]?.date ?? null;
      const observedDays = rows.length;
      const activeDays = rows.filter((r) => r.daily_revenue > 0).length;
      const zeroDays = rows.filter((r) => r.daily_revenue === 0).length;
      const branchTotalRevenue = rows.reduce(
        (sum, r) => sum + r.daily_revenue,
        0,
      );
      const roundedBranchTotal = Math.round(branchTotalRevenue * 100) / 100;
      grandTotalRevenue += roundedBranchTotal;

      const revenues = rows.map((r) => r.daily_revenue);
      const branchMin = revenues.length ? Math.min(...revenues) : 0;
      const branchMax = revenues.length ? Math.max(...revenues) : 0;
      const branchAvg =
        observedDays > 0 ? Math.round((branchTotalRevenue / observedDays) * 100) / 100 : 0;

      if (branchMin < minDailyRevenue) minDailyRevenue = branchMin;
      if (branchMax > maxDailyRevenue) maxDailyRevenue = branchMax;

      if (!overallStartDate || (firstDate && firstDate < overallStartDate)) {
        overallStartDate = firstDate;
      }
      if (!overallEndDate || (lastDate && lastDate > overallEndDate)) {
        overallEndDate = lastDate;
      }

      const hasSufficient = observedDays >= REQUIRED_HISTORY_DAYS;
      if (!hasSufficient) insufficientCount++;

      branchesReport.push({
        branch_id: branchId,
        branch_code: rows[0].branch_code,
        branch_name: rows[0].branch_name,
        first_sale_date: firstDate,
        last_sale_date: lastDate,
        observed_days: observedDays,
        active_sales_days: activeDays,
        zero_sales_days: zeroDays,
        total_revenue: roundedBranchTotal,
        min_daily_revenue: branchMin,
        max_daily_revenue: branchMax,
        avg_daily_revenue: branchAvg,
        has_sufficient_history: hasSufficient,
      });
    }

    if (minDailyRevenue === Infinity) minDailyRevenue = 0.0;

    return {
      generated_at: new Date().toISOString(),
      organization_count: orgs.size,
      total_branches: branchMap.size,
      total_daily_rows: dataset.length,
      total_revenue: Math.round(grandTotalRevenue * 100) / 100,
      min_daily_revenue: minDailyRevenue,
      max_daily_revenue: maxDailyRevenue,
      overall_date_range: {
        start_date: overallStartDate,
        end_date: overallEndDate,
      },
      insufficient_history_branch_count: insufficientCount,
      branches: branchesReport,
    };
  }
}
