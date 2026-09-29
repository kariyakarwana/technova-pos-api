import { Injectable, Logger } from '@nestjs/common';
import { SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  EntityContextInput,
  FutureDemandCalendarPointInput,
  HistoricalDemandPointInput,
} from './interfaces/ai-demand-forecast.interface';

const COLOMBO_TIMEZONE = 'Asia/Colombo';
const MIN_REQUIRED_HISTORY_DAYS = 28;
const MAX_HISTORY_DAYS = 90;

@Injectable()
export class DemandDataExtractionService {
  private readonly logger = new Logger(DemandDataExtractionService.name);
  private readonly colomboFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: COLOMBO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Format any Date into YYYY-MM-DD string in Asia/Colombo timezone.
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
   * Extract historical daily unit demand observations for a specific branch and organization.
   *
   * Security & Integrity:
   * - Strict tenant isolation: verifies branch belongs to organizationId.
   * - Only COMPLETED and PARTIALLY_REFUNDED sales.
   * - Subtracts ReturnItem quantities from SaleItem quantities to compute true net units sold.
   * - Preserves continuous calendar days, inserting 0.0 demand for operating days with zero sales.
   * - Ensures at least 28+ days of historical observations for lag and rolling feature calculations.
   */
  async extractDailyDemandHistory(
    organizationId: string,
    branchId: string,
    options?: { startDate?: Date; endDate?: Date },
  ): Promise<{
    history: HistoricalDemandPointInput[];
    operatesOnSunday: boolean;
    lastObservedDate: string;
  }> {
    const validStatuses: SaleStatus[] = [
      SaleStatus.COMPLETED,
      SaleStatus.PARTIALLY_REFUNDED,
    ];

    const whereClause: Record<string, unknown> = {
      branchId,
      branch: { organizationId },
      status: { in: validStatuses },
    };

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
        completedAt: true,
        createdAt: true,
        items: {
          select: {
            quantity: true,
            returnItems: {
              select: {
                quantity: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const dailyUnitsMap = new Map<string, number>();
    let operatesOnSunday = false;

    for (const sale of sales) {
      const transactionDate = sale.completedAt ?? sale.createdAt;
      const dateStr = this.formatInColombo(transactionDate);

      let saleNetUnits = 0;
      for (const item of sale.items) {
        const grossQty = this.safeDecimalToNumber(item.quantity);
        const returnedQty = item.returnItems.reduce(
          (sum, r) => sum + this.safeDecimalToNumber(r.quantity),
          0,
        );
        saleNetUnits += Math.max(0, grossQty - returnedQty);
      }

      const existingUnits = dailyUnitsMap.get(dateStr) ?? 0;
      const updatedUnits = Math.round((existingUnits + saleNetUnits) * 100) / 100;
      dailyUnitsMap.set(dateStr, updatedUnits);

      // Check if this sale occurred on Sunday in Colombo
      const parsedTx = new Date(`${dateStr}T12:00:00+05:30`);
      if (parsedTx.getUTCDay() === 0 && updatedUnits > 0) {
        operatesOnSunday = true;
      }
    }

    const todayStr = this.formatInColombo(new Date());
    const sortedDates = Array.from(dailyUnitsMap.keys()).sort();

    if (sortedDates.length === 0) {
      return {
        history: [],
        operatesOnSunday: false,
        lastObservedDate: todayStr,
      };
    }

    // Determine calendar bounds
    const firstDateStr = sortedDates[0];
    const lastDateStr = sortedDates[sortedDates.length - 1];

    // Build dense chronological series from firstDate to lastDate
    const denseCalendar: HistoricalDemandPointInput[] = [];
    const curDate = new Date(`${firstDateStr}T00:00:00+05:30`);
    const endDate = new Date(`${lastDateStr}T00:00:00+05:30`);

    while (curDate <= endDate) {
      const dStr = this.formatInColombo(curDate);
      const units = dailyUnitsMap.get(dStr) ?? 0.0;
      const jsDay = curDate.getUTCDay();
      const isSunday = jsDay === 0;
      const isOpen = isSunday ? (operatesOnSunday ? 1 : 0) : 1;

      denseCalendar.push({
        date: dStr,
        demand: Math.max(0, units),
        is_open: isOpen,
      });

      curDate.setUTCDate(curDate.getUTCDate() + 1);
    }

    // Ensure at least MIN_REQUIRED_HISTORY_DAYS (28 days) by prepending zero-sales historical days
    while (denseCalendar.length < MIN_REQUIRED_HISTORY_DAYS) {
      const earliestCurrent = new Date(`${denseCalendar[0]?.date ?? firstDateStr}T00:00:00+05:30`);
      earliestCurrent.setUTCDate(earliestCurrent.getUTCDate() - 1);
      const dStr = this.formatInColombo(earliestCurrent);
      const jsDay = earliestCurrent.getUTCDay();
      const isSunday = jsDay === 0;
      const isOpen = isSunday ? (operatesOnSunday ? 1 : 0) : 1;

      denseCalendar.unshift({
        date: dStr,
        demand: 0.0,
        is_open: isOpen,
      });
    }

    // Cap history to trailing MAX_HISTORY_DAYS (90 days)
    const finalHistory = denseCalendar.slice(-MAX_HISTORY_DAYS);
    const lastObserved = finalHistory[finalHistory.length - 1]?.date ?? todayStr;

    return {
      history: finalHistory,
      operatesOnSunday,
      lastObservedDate: lastObserved,
    };
  }

  /**
   * Build future calendar operating conditions for a given forecast horizon.
   */
  buildFutureCalendar(
    baseDateStr: string,
    horizon: number,
    operatesOnSunday: boolean,
    activeDiscountRules: { startsAt: Date | null; endsAt: Date | null }[],
  ): FutureDemandCalendarPointInput[] {
    const baseDate = new Date(`${baseDateStr}T12:00:00+05:30`);
    const futureCalendar: FutureDemandCalendarPointInput[] = [];

    for (let h = 0; h < horizon; h++) {
      const targetDay = new Date(baseDate);
      targetDay.setDate(baseDate.getDate() + 1 + h);
      const dateStr = this.formatInColombo(targetDay);

      const jsDay = targetDay.getUTCDay();
      const isSunday = jsDay === 0;
      const isOperatingDay = isSunday ? (operatesOnSunday ? 1 : 0) : 1;

      const dayStart = new Date(`${dateStr}T00:00:00+05:30`);
      const dayEnd = new Date(`${dateStr}T23:59:59.999+05:30`);

      const hasActiveDiscount = activeDiscountRules.some((rule) => {
        const afterStart = !rule.startsAt || rule.startsAt <= dayEnd;
        const beforeEnd = !rule.endsAt || rule.endsAt >= dayStart;
        return afterStart && beforeEnd;
      });

      futureCalendar.push({
        date: dateStr,
        is_open: isOperatingDay,
        promo: hasActiveDiscount ? 1 : 0,
        state_holiday: 0,
        school_holiday: 0,
      });
    }

    return futureCalendar;
  }

  /**
   * Provide standardized entity/store context characteristics.
   */
  async getBranchEntityContext(
    _organizationId: string,
    _branchId: string,
  ): Promise<EntityContextInput> {
    return {
      store_type: 0,
      assortment: 0,
      competition_distance: 1000.0,
      has_competition: 1,
      competition_open_months: 12.0,
      promo2: 0,
      has_active_promo2: 0,
    };
  }
}
