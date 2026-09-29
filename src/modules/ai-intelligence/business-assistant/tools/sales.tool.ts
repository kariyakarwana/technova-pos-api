import { Injectable, Logger } from '@nestjs/common';
import { RecordStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import {
  formatColomboDate,
  resolveDateRange,
  safeDecimal,
} from './date-utils';
import { ToolRegistryService } from './tool-registry.service';

export type SalesOperation = 'summary' | 'by_branch' | 'by_product' | 'comparison' | 'trend';

export interface SalesToolParams {
  operation?: SalesOperation;
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  limit?: number;
}

@Injectable()
export class SalesTool implements IBusinessTool<SalesToolParams> {
  readonly name = 'SalesTool';
  readonly description = 'Queries historical sales, branch revenue, top-selling products, trends, and period comparisons.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    operation: {
      type: 'string',
      description: 'The sales query operation: summary, by_branch, by_product, comparison, or trend',
      required: true,
      enum: ['summary', 'by_branch', 'by_product', 'comparison', 'trend'],
    },
    dateFrom: {
      type: 'string',
      description: 'Start date in ISO or YYYY-MM-DD format (defaults to 30 days ago)',
      required: false,
    },
    dateTo: {
      type: 'string',
      description: 'End date in ISO or YYYY-MM-DD format (defaults to today)',
      required: false,
    },
    branchId: {
      type: 'string',
      description: 'Optional branch ID filter',
      required: false,
    },
    limit: {
      type: 'number',
      description: 'Max number of product records (default 10, max 50)',
      required: false,
    },
  };

  private readonly logger = new Logger(SalesTool.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(params: SalesToolParams, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const operation = params.operation ?? 'summary';

    // 1. Enforce branch authorization
    const branchValidation = await this.resolveEffectiveBranch(params.branchId, context);
    if (!branchValidation.authorized) {
      return {
        success: false,
        error: branchValidation.error ?? 'Unauthorized branch access.',
      };
    }
    const effectiveBranchId = branchValidation.branchId;

    try {
      let data: unknown;
      let recordCount = 0;
      const { start, end, label: timeRange } = resolveDateRange(params.dateFrom, params.dateTo, 30);

      switch (operation) {
        case 'summary': {
          const summary = await this.executeSummary(context.organizationId, effectiveBranchId, start, end);
          data = summary;
          recordCount = summary.transactionCount;
          break;
        }

        case 'by_branch': {
          const branchSales = await this.executeByBranch(context.organizationId, effectiveBranchId, start, end);
          data = branchSales;
          recordCount = branchSales.length;
          break;
        }

        case 'by_product': {
          const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
          const topProducts = await this.executeByProduct(context.organizationId, effectiveBranchId, start, end, limit);
          data = topProducts;
          recordCount = topProducts.length;
          break;
        }

        case 'comparison': {
          const comparison = await this.executeComparison(context.organizationId, effectiveBranchId, start, end);
          data = comparison;
          recordCount = comparison.currentPeriod.transactionCount + comparison.previousPeriod.transactionCount;
          break;
        }

        case 'trend': {
          const trend = await this.executeTrend(context.organizationId, effectiveBranchId, start, end);
          data = trend;
          recordCount = trend.length;
          break;
        }

        default:
          return {
            success: false,
            error: `Unsupported sales operation "${operation}". Supported operations are: summary, by_branch, by_product, comparison, trend.`,
          };
      }

      return {
        success: true,
        data,
        metadata: {
          source: 'SalesDatabase',
          recordCount,
          timeRange,
          branchId: effectiveBranchId,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`SalesTool failed executing operation "${operation}"`, err);
      return {
        success: false,
        error: 'An internal error occurred while retrieving sales records.',
      };
    }
  }

  private async resolveEffectiveBranch(
    requestedBranchId: string | undefined,
    context: ToolExecutionContext,
  ): Promise<{ authorized: boolean; branchId?: string; error?: string }> {
    // If context is already constrained to a specific branch (e.g. branch manager)
    if (context.branchId) {
      if (requestedBranchId && requestedBranchId !== context.branchId) {
        return {
          authorized: false,
          error: `User is restricted to branch "${context.branchId}" and cannot query branch "${requestedBranchId}".`,
        };
      }
      return { authorized: true, branchId: context.branchId };
    }

    // If client requested a branch, verify it belongs to organization
    if (requestedBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: {
          id: requestedBranchId,
          organizationId: context.organizationId,
          status: RecordStatus.ACTIVE,
        },
        select: { id: true },
      });

      if (!branch) {
        return {
          authorized: false,
          error: `Branch "${requestedBranchId}" not found or inactive in this organization.`,
        };
      }
      return { authorized: true, branchId: requestedBranchId };
    }

    return { authorized: true, branchId: undefined };
  }

  private async executeSummary(
    organizationId: string,
    branchId: string | undefined,
    start: Date,
    end: Date,
  ) {
    const where = {
      branch: { organizationId },
      ...(branchId ? { branchId } : {}),
      status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
      createdAt: { gte: start, lte: end },
    };

    const [aggregate, count] = await Promise.all([
      this.prisma.sale.aggregate({
        where,
        _sum: { total: true, subtotal: true, discountTotal: true, taxTotal: true },
        _avg: { total: true },
      }),
      this.prisma.sale.count({ where }),
    ]);

    const totalRevenue = safeDecimal(aggregate._sum.total);
    const averageTransactionValue = count > 0 ? safeDecimal(aggregate._avg.total) : 0;

    return {
      totalRevenue,
      transactionCount: count,
      averageTransactionValue,
      totalDiscount: safeDecimal(aggregate._sum.discountTotal),
      totalTax: safeDecimal(aggregate._sum.taxTotal),
      dateFrom: formatColomboDate(start),
      dateTo: formatColomboDate(end),
      branchScope: branchId ?? 'ALL_BRANCHES',
    };
  }

  private async executeByBranch(
    organizationId: string,
    branchId: string | undefined,
    start: Date,
    end: Date,
  ) {
    const where = {
      branch: { organizationId },
      ...(branchId ? { branchId } : {}),
      status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
      createdAt: { gte: start, lte: end },
    };

    const [grouped, branches] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['branchId'],
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
      this.prisma.branch.findMany({
        where: { organizationId, status: RecordStatus.ACTIVE },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const branchMap = new Map(branches.map((b) => [b.id, b]));

    return grouped.map((g) => {
      const branchInfo = branchMap.get(g.branchId);
      const revenue = safeDecimal(g._sum.total);
      const count = g._count.id;
      return {
        branchId: g.branchId,
        branchName: branchInfo?.name ?? 'Unknown Branch',
        branchCode: branchInfo?.code ?? '',
        revenue,
        transactionCount: count,
        averageTransactionValue: count > 0 ? safeDecimal(revenue / count) : 0,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  private async executeByProduct(
    organizationId: string,
    branchId: string | undefined,
    start: Date,
    end: Date,
    limit: number,
  ) {
    const items = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          branch: { organizationId },
          ...(branchId ? { branchId } : {}),
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
          createdAt: { gte: start, lte: end },
        },
      },
      _sum: { quantity: true, lineTotal: true },
      _count: { id: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: limit,
    });

    if (items.length === 0) return [];

    const productIds = items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, sellingPrice: true },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    return items.map((item) => {
      const prod = productMap.get(item.productId);
      const revenue = safeDecimal(item._sum.lineTotal);
      const unitsSold = safeDecimal(item._sum.quantity, 1);
      return {
        productId: item.productId,
        productName: prod?.name ?? 'Unknown Product',
        sku: prod?.sku ?? '',
        unitsSold,
        revenue,
        orderCount: item._count.id,
      };
    });
  }

  private async executeComparison(
    organizationId: string,
    branchId: string | undefined,
    start: Date,
    end: Date,
  ) {
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime());
    const prevStart = new Date(start.getTime() - durationMs);

    const [currentSummary, previousSummary] = await Promise.all([
      this.executeSummary(organizationId, branchId, start, end),
      this.executeSummary(organizationId, branchId, prevStart, prevEnd),
    ]);

    const revenueChange = safeDecimal(currentSummary.totalRevenue - previousSummary.totalRevenue);
    const revenuePercentageChange = previousSummary.totalRevenue > 0
      ? safeDecimal(((currentSummary.totalRevenue - previousSummary.totalRevenue) / previousSummary.totalRevenue) * 100, 1)
      : null;

    const ordersChange = currentSummary.transactionCount - previousSummary.transactionCount;
    const ordersPercentageChange = previousSummary.transactionCount > 0
      ? safeDecimal(((currentSummary.transactionCount - previousSummary.transactionCount) / previousSummary.transactionCount) * 100, 1)
      : null;

    return {
      currentPeriod: currentSummary,
      previousPeriod: previousSummary,
      delta: {
        revenueChange,
        revenuePercentageChange,
        ordersChange,
        ordersPercentageChange,
      },
    };
  }

  private async executeTrend(
    organizationId: string,
    branchId: string | undefined,
    start: Date,
    end: Date,
  ) {
    const sales = await this.prisma.sale.findMany({
      where: {
        branch: { organizationId },
        ...(branchId ? { branchId } : {}),
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        createdAt: { gte: start, lte: end },
      },
      select: {
        total: true,
        completedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const dailyMap = new Map<string, { revenue: number; orders: number }>();

    for (const sale of sales) {
      const dateKey = formatColomboDate(sale.completedAt ?? sale.createdAt);
      const existing = dailyMap.get(dateKey) ?? { revenue: 0, orders: 0 };
      existing.revenue += safeDecimal(sale.total);
      existing.orders += 1;
      dailyMap.set(dateKey, existing);
    }

    return Array.from(dailyMap.entries())
      .map(([date, stats]) => ({
        date,
        revenue: safeDecimal(stats.revenue),
        orders: stats.orders,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
