import { Injectable, Logger } from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import { safeDecimal } from './date-utils';
import { ToolRegistryService } from './tool-registry.service';

export type InventoryOperation =
  | 'summary'
  | 'low_stock'
  | 'out_of_stock'
  | 'by_branch'
  | 'product_stock';

export interface InventoryToolParams {
  operation?: InventoryOperation;
  branchId?: string;
  productId?: string;
  search?: string;
  limit?: number;
}

@Injectable()
export class InventoryTool implements IBusinessTool<InventoryToolParams> {
  readonly name = 'InventoryTool';
  readonly description = 'Queries inventory stock levels, low-stock alerts, out-of-stock items, branch stock distribution, and product availability.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    operation: {
      type: 'string',
      description: 'The inventory query operation: summary, low_stock, out_of_stock, by_branch, or product_stock',
      required: true,
      enum: ['summary', 'low_stock', 'out_of_stock', 'by_branch', 'product_stock'],
    },
    branchId: {
      type: 'string',
      description: 'Optional branch ID filter',
      required: false,
    },
    productId: {
      type: 'string',
      description: 'Optional product ID for specific product stock lookup',
      required: false,
    },
    search: {
      type: 'string',
      description: 'Optional search keyword for product name, SKU, or barcode',
      required: false,
    },
    limit: {
      type: 'number',
      description: 'Max number of records to return (default 20, max 50)',
      required: false,
    },
  };

  private readonly logger = new Logger(InventoryTool.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(params: InventoryToolParams, context: ToolExecutionContext): Promise<ToolResult> {
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
      const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

      switch (operation) {
        case 'summary': {
          const summary = await this.executeSummary(context.organizationId, effectiveBranchId);
          data = summary;
          recordCount = summary.totalActiveProducts;
          break;
        }

        case 'low_stock': {
          const lowStock = await this.executeLowStock(context.organizationId, effectiveBranchId, limit);
          data = lowStock;
          recordCount = lowStock.length;
          break;
        }

        case 'out_of_stock': {
          const outOfStock = await this.executeOutOfStock(context.organizationId, effectiveBranchId, limit);
          data = outOfStock;
          recordCount = outOfStock.length;
          break;
        }

        case 'by_branch': {
          const branchBreakdown = await this.executeByBranch(context.organizationId, effectiveBranchId);
          data = branchBreakdown;
          recordCount = branchBreakdown.length;
          break;
        }

        case 'product_stock': {
          const productStock = await this.executeProductStock(
            context.organizationId,
            effectiveBranchId,
            params.productId,
            params.search,
          );
          data = productStock;
          recordCount = productStock ? 1 : 0;
          break;
        }

        default:
          return {
            success: false,
            error: `Unsupported inventory operation "${operation}". Supported operations are: summary, low_stock, out_of_stock, by_branch, product_stock.`,
          };
      }

      return {
        success: true,
        data,
        metadata: {
          source: 'InventoryDatabase',
          recordCount,
          branchId: effectiveBranchId,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`InventoryTool failed executing operation "${operation}"`, err);
      return {
        success: false,
        error: 'An internal error occurred while retrieving inventory records.',
      };
    }
  }

  private async resolveEffectiveBranch(
    requestedBranchId: string | undefined,
    context: ToolExecutionContext,
  ): Promise<{ authorized: boolean; branchId?: string; error?: string }> {
    if (context.branchId) {
      if (requestedBranchId && requestedBranchId !== context.branchId) {
        return {
          authorized: false,
          error: `User is restricted to branch "${context.branchId}" and cannot query branch "${requestedBranchId}".`,
        };
      }
      return { authorized: true, branchId: context.branchId };
    }

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

  private async executeSummary(organizationId: string, branchId?: string) {
    const whereBranch = {
      organizationId,
      status: RecordStatus.ACTIVE,
      ...(branchId ? { id: branchId } : {}),
    };

    const [activeProductsCount, stockLevels] = await Promise.all([
      this.prisma.product.count({
        where: { organizationId, status: RecordStatus.ACTIVE },
      }),
      this.prisma.stockLevel.findMany({
        where: {
          branch: whereBranch,
        },
        include: {
          product: {
            select: {
              costPrice: true,
              sellingPrice: true,
              reorderLevel: true,
              status: true,
            },
          },
        },
      }),
    ]);

    let totalUnitsOnHand = 0;
    let totalUnitsReserved = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const level of stockLevels) {
      const onHand = safeDecimal(level.quantityOnHand, 3);
      const reserved = safeDecimal(level.quantityReserved, 3);
      const cost = safeDecimal(level.product.costPrice, 2);
      const price = safeDecimal(level.product.sellingPrice, 2);
      const reorder = safeDecimal(level.product.reorderLevel, 3);

      totalUnitsOnHand += onHand;
      totalUnitsReserved += reserved;
      totalCostValuation += onHand * cost;
      totalRetailValuation += onHand * price;

      if (onHand <= 0) {
        outOfStockCount++;
      } else if (reorder > 0 && onHand <= reorder) {
        lowStockCount++;
      }
    }

    return {
      totalActiveProducts: activeProductsCount,
      totalTrackedStockRecords: stockLevels.length,
      totalUnitsOnHand: safeDecimal(totalUnitsOnHand, 1),
      totalUnitsReserved: safeDecimal(totalUnitsReserved, 1),
      totalUnitsAvailable: safeDecimal(totalUnitsOnHand - totalUnitsReserved, 1),
      totalCostValuation: safeDecimal(totalCostValuation, 2),
      totalRetailValuation: safeDecimal(totalRetailValuation, 2),
      lowStockItemsCount: lowStockCount,
      outOfStockItemsCount: outOfStockCount,
      branchScope: branchId ?? 'ALL_BRANCHES',
    };
  }

  private async executeLowStock(organizationId: string, branchId: string | undefined, limit: number) {
    const stockLevels = await this.prisma.stockLevel.findMany({
      where: {
        branch: {
          organizationId,
          status: RecordStatus.ACTIVE,
          ...(branchId ? { id: branchId } : {}),
        },
        product: {
          status: RecordStatus.ACTIVE,
        },
        quantityOnHand: { gt: 0 },
      },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            reorderLevel: true,
            costPrice: true,
            sellingPrice: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      take: 200, // Pre-filter candidates
    });

    const lowStockItems = stockLevels
      .map((item) => {
        const onHand = safeDecimal(item.quantityOnHand, 3);
        const reserved = safeDecimal(item.quantityReserved, 3);
        const reorderLevel = safeDecimal(item.product.reorderLevel, 3);
        const threshold = reorderLevel > 0 ? reorderLevel : 5; // default low-stock threshold if unset
        const isLow = onHand <= threshold;

        return {
          productId: item.productId,
          productName: item.product.name,
          sku: item.product.sku,
          branchId: item.branchId,
          branchName: item.branch.name,
          quantityOnHand: onHand,
          quantityReserved: reserved,
          reorderLevel,
          shortage: safeDecimal(Math.max(threshold - onHand, 0), 1),
          unitCostPrice: safeDecimal(item.product.costPrice),
          unitSellingPrice: safeDecimal(item.product.sellingPrice),
          isLow,
        };
      })
      .filter((item) => item.isLow)
      .sort((a, b) => a.quantityOnHand - b.quantityOnHand)
      .slice(0, limit);

    return lowStockItems;
  }

  private async executeOutOfStock(organizationId: string, branchId: string | undefined, limit: number) {
    const stockLevels = await this.prisma.stockLevel.findMany({
      where: {
        branch: {
          organizationId,
          status: RecordStatus.ACTIVE,
          ...(branchId ? { id: branchId } : {}),
        },
        product: {
          status: RecordStatus.ACTIVE,
        },
        quantityOnHand: { lte: 0 },
      },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            reorderLevel: true,
            costPrice: true,
            sellingPrice: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    return stockLevels.map((item) => ({
      productId: item.productId,
      productName: item.product.name,
      sku: item.product.sku,
      branchId: item.branchId,
      branchName: item.branch.name,
      quantityOnHand: safeDecimal(item.quantityOnHand, 3),
      reorderLevel: safeDecimal(item.product.reorderLevel, 3),
      unitSellingPrice: safeDecimal(item.product.sellingPrice),
    }));
  }

  private async executeByBranch(organizationId: string, branchId?: string) {
    const branches = await this.prisma.branch.findMany({
      where: {
        organizationId,
        status: RecordStatus.ACTIVE,
        ...(branchId ? { id: branchId } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    const stockLevels = await this.prisma.stockLevel.findMany({
      where: {
        branch: {
          organizationId,
          status: RecordStatus.ACTIVE,
          ...(branchId ? { id: branchId } : {}),
        },
      },
      include: {
        product: {
          select: {
            costPrice: true,
            sellingPrice: true,
            reorderLevel: true,
          },
        },
      },
    });

    const branchSummaryMap = new Map<
      string,
      {
        totalItemsCount: number;
        totalUnitsOnHand: number;
        costValuation: number;
        retailValuation: number;
        lowStockCount: number;
        outOfStockCount: number;
      }
    >();

    for (const b of branches) {
      branchSummaryMap.set(b.id, {
        totalItemsCount: 0,
        totalUnitsOnHand: 0,
        costValuation: 0,
        retailValuation: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
      });
    }

    for (const item of stockLevels) {
      const stats = branchSummaryMap.get(item.branchId);
      if (!stats) continue;

      const onHand = safeDecimal(item.quantityOnHand, 3);
      const cost = safeDecimal(item.product.costPrice, 2);
      const price = safeDecimal(item.product.sellingPrice, 2);
      const reorder = safeDecimal(item.product.reorderLevel, 3);

      stats.totalItemsCount += 1;
      stats.totalUnitsOnHand += onHand;
      stats.costValuation += onHand * cost;
      stats.retailValuation += onHand * price;

      if (onHand <= 0) {
        stats.outOfStockCount += 1;
      } else if (reorder > 0 && onHand <= reorder) {
        stats.lowStockCount += 1;
      }
    }

    return branches.map((b) => {
      const stats = branchSummaryMap.get(b.id) ?? {
        totalItemsCount: 0,
        totalUnitsOnHand: 0,
        costValuation: 0,
        retailValuation: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
      };

      return {
        branchId: b.id,
        branchName: b.name,
        branchCode: b.code,
        totalItemsCount: stats.totalItemsCount,
        totalUnitsOnHand: safeDecimal(stats.totalUnitsOnHand, 1),
        costValuation: safeDecimal(stats.costValuation, 2),
        retailValuation: safeDecimal(stats.retailValuation, 2),
        lowStockCount: stats.lowStockCount,
        outOfStockCount: stats.outOfStockCount,
      };
    });
  }

  private async executeProductStock(
    organizationId: string,
    branchId?: string,
    productId?: string,
    search?: string,
  ) {
    if (!productId && !search) {
      return null;
    }

    const product = await this.prisma.product.findFirst({
      where: {
        organizationId,
        status: RecordStatus.ACTIVE,
        OR: [
          ...(productId ? [{ id: productId }] : []),
          ...(search
            ? [
                { sku: { equals: search, mode: 'insensitive' as const } },
                { barcode: { equals: search } },
                { name: { contains: search, mode: 'insensitive' as const } },
              ]
            : []),
        ],
      },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        stockLevels: {
          where: {
            branch: {
              organizationId,
              status: RecordStatus.ACTIVE,
              ...(branchId ? { id: branchId } : {}),
            },
          },
          include: {
            branch: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!product) return null;

    const reorderLevel = safeDecimal(product.reorderLevel, 3);
    let totalOnHand = 0;
    let totalReserved = 0;

    const branches = product.stockLevels.map((lvl) => {
      const onHand = safeDecimal(lvl.quantityOnHand, 3);
      const reserved = safeDecimal(lvl.quantityReserved, 3);
      totalOnHand += onHand;
      totalReserved += reserved;

      return {
        branchId: lvl.branch.id,
        branchName: lvl.branch.name,
        branchCode: lvl.branch.code,
        quantityOnHand: onHand,
        quantityReserved: reserved,
        quantityAvailable: safeDecimal(onHand - reserved, 3),
        isLowStock: reorderLevel > 0 ? onHand <= reorderLevel : onHand <= 5,
        isOutOfStock: onHand <= 0,
      };
    });

    return {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      barcode: product.barcode,
      category: product.category?.name ?? null,
      brand: product.brand?.name ?? null,
      costPrice: safeDecimal(product.costPrice),
      sellingPrice: safeDecimal(product.sellingPrice),
      reorderLevel,
      totalUnitsOnHand: safeDecimal(totalOnHand, 1),
      totalUnitsReserved: safeDecimal(totalReserved, 1),
      totalUnitsAvailable: safeDecimal(totalOnHand - totalReserved, 1),
      branchStock: branches,
    };
  }
}
