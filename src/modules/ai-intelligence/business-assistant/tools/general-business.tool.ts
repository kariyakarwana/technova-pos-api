/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions */
import { Injectable, Logger } from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import { BranchesTool } from './branches.tool';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import { safeDecimal } from './date-utils';
import { InventoryTool } from './inventory.tool';
import { ProductsTool } from './products.tool';
import { SalesTool } from './sales.tool';
import { ToolRegistryService } from './tool-registry.service';

export type GeneralBusinessOperation =
  | 'business_summary'
  | 'branch_overview'
  | 'business_kpis'
  | 'business_health';

export interface GeneralBusinessToolParams {
  operation?: GeneralBusinessOperation;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class GeneralBusinessTool implements IBusinessTool<GeneralBusinessToolParams> {
  readonly name = 'GeneralBusinessTool';
  readonly description = 'Provides holistic executive business summaries, multi-domain branch overviews, KPIs, and factual operational health indicators.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    operation: {
      type: 'string',
      description: 'The business overview operation: business_summary, branch_overview, business_kpis, or business_health',
      required: true,
      enum: ['business_summary', 'branch_overview', 'business_kpis', 'business_health'],
    },
    dateFrom: {
      type: 'string',
      description: 'Optional start date for sales data in summary (defaults to last 30 days)',
      required: false,
    },
    dateTo: {
      type: 'string',
      description: 'Optional end date for sales data in summary (defaults to today)',
      required: false,
    },
  };

  private readonly logger = new Logger(GeneralBusinessTool.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salesTool: SalesTool,
    private readonly inventoryTool: InventoryTool,
    private readonly productsTool: ProductsTool,
    private readonly branchesTool: BranchesTool,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(params: GeneralBusinessToolParams, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const operation = params.operation ?? 'business_summary';

    try {
      let data: unknown;
      let recordCount = 0;

      switch (operation) {
        case 'business_summary': {
          const summary = await this.executeBusinessSummary(params, context);
          data = summary;
          recordCount = 1;
          break;
        }

        case 'branch_overview': {
          const overview = await this.executeBranchOverview(params, context);
          data = overview;
          recordCount = overview.length;
          break;
        }

        case 'business_kpis': {
          const kpis = await this.executeBusinessKpis(params, context);
          data = kpis;
          recordCount = 1;
          break;
        }

        case 'business_health': {
          const health = await this.executeBusinessHealth(params, context);
          data = health;
          recordCount = 1;
          break;
        }

        default:
          return {
            success: false,
            error: 'Unsupported general business operation. Supported operations are: business_summary, branch_overview, business_kpis, business_health.',
          };
      }

      return {
        success: true,
        data,
        metadata: {
          source: 'GeneralBusinessAggregator',
          recordCount,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`GeneralBusinessTool failed executing operation "${operation}"`, err);
      return {
        success: false,
        error: 'An internal error occurred while compiling the general business summary.',
      };
    }
  }

  private async executeBusinessSummary(params: GeneralBusinessToolParams, context: ToolExecutionContext) {
    const [salesResult, invResult, branchResult, customerCount] = await Promise.all([
      this.salesTool.execute({ operation: 'summary', dateFrom: params.dateFrom, dateTo: params.dateTo }, context),
      this.inventoryTool.execute({ operation: 'summary' }, context),
      this.branchesTool.execute({ operation: 'branch_summary' }, context),
      this.prisma.customer.count({ where: { organizationId: context.organizationId, status: RecordStatus.ACTIVE } }),
    ]);

    return {
      sales: salesResult.success ? salesResult.data : null,
      inventory: invResult.success ? invResult.data : null,
      branches: branchResult.success ? branchResult.data : null,
      activeCustomerCount: customerCount,
      organizationId: context.organizationId,
      branchScope: context.branchId ?? 'ALL_BRANCHES',
    };
  }

  private async executeBranchOverview(params: GeneralBusinessToolParams, context: ToolExecutionContext) {
    const [salesByBranchResult, invByBranchResult] = await Promise.all([
      this.salesTool.execute({ operation: 'by_branch', dateFrom: params.dateFrom, dateTo: params.dateTo }, context),
      this.inventoryTool.execute({ operation: 'by_branch' }, context),
    ]);

    const salesList = (salesByBranchResult.success && Array.isArray(salesByBranchResult.data)
      ? salesByBranchResult.data
      : []) as Array<{
      branchId: string;
      branchName: string;
      branchCode: string;
      revenue: number;
      transactionCount: number;
      averageTransactionValue: number;
    }>;

    const invList = (invByBranchResult.success && Array.isArray(invByBranchResult.data)
      ? invByBranchResult.data
      : []) as Array<{
      branchId: string;
      branchName: string;
      branchCode: string;
      totalItemsCount: number;
      totalUnitsOnHand: number;
      costValuation: number;
      retailValuation: number;
      lowStockCount: number;
      outOfStockCount: number;
    }>;

    const branchIds = new Set([...salesList.map((s) => s.branchId), ...invList.map((i) => i.branchId)]);
    const salesMap = new Map(salesList.map((s) => [s.branchId, s]));
    const invMap = new Map(invList.map((i) => [i.branchId, i]));

    const merged = Array.from(branchIds).map((id) => {
      const sales = salesMap.get(id);
      const inv = invMap.get(id);
      return {
        branchId: id,
        branchName: sales?.branchName ?? inv?.branchName ?? 'Unknown Branch',
        branchCode: sales?.branchCode ?? inv?.branchCode ?? '',
        sales: {
          revenue: sales?.revenue ?? 0,
          orders: sales?.transactionCount ?? 0,
          averageOrderValue: sales?.averageTransactionValue ?? 0,
        },
        inventory: {
          unitsOnHand: inv?.totalUnitsOnHand ?? 0,
          retailValuation: inv?.retailValuation ?? 0,
          lowStockCount: inv?.lowStockCount ?? 0,
          outOfStockCount: inv?.outOfStockCount ?? 0,
        },
      };
    });

    return merged.sort((a, b) => b.sales.revenue - a.sales.revenue);
  }

  private async executeBusinessKpis(params: GeneralBusinessToolParams, context: ToolExecutionContext) {
    const [salesResult, invResult] = await Promise.all([
      this.salesTool.execute({ operation: 'summary', dateFrom: params.dateFrom, dateTo: params.dateTo }, context),
      this.inventoryTool.execute({ operation: 'summary' }, context),
    ]);

    const salesData = (salesResult.success ? salesResult.data : {}) as Record<string, unknown>;
    const invData = (invResult.success ? invResult.data : {}) as Record<string, unknown>;

    return {
      kpiCards: [
        {
          label: 'Total Revenue',
          value: `$${salesData.totalRevenue ?? 0}`,
          change: 'Current Period',
          trend: 'neutral',
        },
        {
          label: 'Total Completed Orders',
          value: `${salesData.transactionCount ?? 0}`,
          unit: 'orders',
        },
        {
          label: 'Average Order Value',
          value: `$${salesData.averageTransactionValue ?? 0}`,
        },
        {
          label: 'Inventory Retail Value',
          value: `$${invData.totalRetailValuation ?? 0}`,
        },
        {
          label: 'Low Stock Alerts',
          value: `${invData.lowStockItemsCount ?? 0}`,
          unit: 'products',
        },
      ],
    };
  }

  private async executeBusinessHealth(params: GeneralBusinessToolParams, context: ToolExecutionContext) {
    const invResult = await this.inventoryTool.execute({ operation: 'summary' }, context);
    const invData = (invResult.success ? invResult.data : {}) as Record<string, unknown>;

    const totalProducts = Number(invData.totalActiveProducts ?? 0);
    const outOfStockCount = Number(invData.outOfStockItemsCount ?? 0);
    const lowStockCount = Number(invData.lowStockItemsCount ?? 0);

    const outOfStockRate = totalProducts > 0 ? safeDecimal((outOfStockCount / totalProducts) * 100, 1) : 0;
    const lowStockRate = totalProducts > 0 ? safeDecimal((lowStockCount / totalProducts) * 100, 1) : 0;

    return {
      totalActiveProducts: totalProducts,
      outOfStockCount,
      outOfStockRatePercent: outOfStockRate,
      lowStockCount,
      lowStockRatePercent: lowStockRate,
      totalUnitsOnHand: invData.totalUnitsOnHand ?? 0,
      inventoryValuationCost: invData.totalCostValuation ?? 0,
      inventoryValuationRetail: invData.totalRetailValuation ?? 0,
    };
  }
}
