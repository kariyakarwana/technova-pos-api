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

export type ProductOperation =
  | 'product_search'
  | 'product_details'
  | 'active_products'
  | 'product_pricing'
  | 'product_stock'
  | 'product_summary';

export interface ProductsToolParams {
  operation?: ProductOperation;
  search?: string;
  productId?: string;
  categoryId?: string;
  brandId?: string;
  limit?: number;
}

@Injectable()
export class ProductsTool implements IBusinessTool<ProductsToolParams> {
  readonly name = 'ProductsTool';
  readonly description = 'Queries catalog products, SKU/barcode search, pricing, margins, and category summaries.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    operation: {
      type: 'string',
      description: 'The product query operation: product_search, product_details, active_products, product_pricing, product_stock, or product_summary',
      required: true,
      enum: [
        'product_search',
        'product_details',
        'active_products',
        'product_pricing',
        'product_stock',
        'product_summary',
      ],
    },
    search: {
      type: 'string',
      description: 'Search keyword matching product name, SKU, or barcode',
      required: false,
    },
    productId: {
      type: 'string',
      description: 'Specific product ID for detailed lookup',
      required: false,
    },
    categoryId: {
      type: 'string',
      description: 'Optional category ID filter',
      required: false,
    },
    brandId: {
      type: 'string',
      description: 'Optional brand ID filter',
      required: false,
    },
    limit: {
      type: 'number',
      description: 'Max number of records (default 20, max 50)',
      required: false,
    },
  };

  private readonly logger = new Logger(ProductsTool.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(params: ProductsToolParams, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const operation = params.operation ?? 'product_summary';
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

    try {
      let data: unknown;
      let recordCount = 0;

      switch (operation) {
        case 'product_search': {
          const results = await this.executeProductSearch(context.organizationId, params.search, limit);
          data = results;
          recordCount = results.length;
          break;
        }

        case 'product_details': {
          const details = await this.executeProductDetails(
            context.organizationId,
            params.productId,
            params.search,
            context.branchId,
          );
          data = details;
          recordCount = details ? 1 : 0;
          break;
        }

        case 'active_products': {
          const activeList = await this.executeActiveProducts(
            context.organizationId,
            params.categoryId,
            params.brandId,
            limit,
          );
          data = activeList;
          recordCount = activeList.length;
          break;
        }

        case 'product_pricing': {
          const pricing = await this.executeProductPricing(
            context.organizationId,
            params.search,
            params.categoryId,
            limit,
          );
          data = pricing;
          recordCount = pricing.length;
          break;
        }

        case 'product_stock': {
          const stock = await this.executeProductStock(
            context.organizationId,
            params.search,
            params.productId,
            context.branchId,
            limit,
          );
          data = stock;
          recordCount = stock.length;
          break;
        }

        case 'product_summary': {
          const summary = await this.executeProductSummary(context.organizationId);
          data = summary;
          recordCount = summary.totalProducts;
          break;
        }

        default:
          return {
            success: false,
            error: 'Unsupported product operation. Supported operations are: product_search, product_details, active_products, product_pricing, product_stock, product_summary.',
          };
      }

      return {
        success: true,
        data,
        metadata: {
          source: 'ProductsCatalog',
          recordCount,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`ProductsTool failed executing operation "${operation}"`, err);
      return {
        success: false,
        error: 'An internal error occurred while retrieving product information.',
      };
    }
  }

  private async executeProductSearch(organizationId: string, search?: string, limit = 20) {
    const where: Record<string, unknown> = {
      organizationId,
      status: RecordStatus.ACTIVE,
    };

    if (search && search.trim().length > 0) {
      const keyword = search.trim();
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { sku: { contains: keyword, mode: 'insensitive' } },
        { barcode: { equals: keyword } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      categoryName: p.category?.name ?? null,
      brandName: p.brand?.name ?? null,
      costPrice: safeDecimal(p.costPrice),
      sellingPrice: safeDecimal(p.sellingPrice),
      reorderLevel: safeDecimal(p.reorderLevel, 3),
      status: p.status,
    }));
  }

  private async executeProductDetails(
    organizationId: string,
    productId?: string,
    search?: string,
    branchId?: string,
  ) {
    if (!productId && !search) {
      return null;
    }

    const where: Record<string, unknown> = {
      organizationId,
    };

    if (productId) {
      where.id = productId;
    } else if (search) {
      const term = search.trim();
      where.OR = [
        { sku: { equals: term, mode: 'insensitive' } },
        { barcode: { equals: term } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }

    const product = await this.prisma.product.findFirst({
      where,
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
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

    const cost = safeDecimal(product.costPrice);
    const selling = safeDecimal(product.sellingPrice);
    const marginAmount = safeDecimal(selling - cost);
    const marginPercent = selling > 0 ? safeDecimal(((selling - cost) / selling) * 100, 1) : 0;

    let totalOnHand = 0;
    let totalReserved = 0;
    const branchStock = product.stockLevels.map((s) => {
      const onHand = safeDecimal(s.quantityOnHand, 3);
      const reserved = safeDecimal(s.quantityReserved, 3);
      totalOnHand += onHand;
      totalReserved += reserved;
      return {
        branchId: s.branch.id,
        branchName: s.branch.name,
        branchCode: s.branch.code,
        quantityOnHand: onHand,
        quantityReserved: reserved,
        quantityAvailable: safeDecimal(onHand - reserved, 3),
      };
    });

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      description: product.description,
      status: product.status,
      category: product.category?.name ?? null,
      brand: product.brand?.name ?? null,
      costPrice: cost,
      sellingPrice: selling,
      taxRate: safeDecimal(product.taxRate, 4),
      marginAmount,
      marginPercent,
      reorderLevel: safeDecimal(product.reorderLevel, 3),
      trackSerials: product.trackSerials,
      totalUnitsOnHand: safeDecimal(totalOnHand, 1),
      totalUnitsAvailable: safeDecimal(totalOnHand - totalReserved, 1),
      branchStock,
    };
  }

  private async executeActiveProducts(
    organizationId: string,
    categoryId?: string,
    brandId?: string,
    limit = 20,
  ) {
    const where: Record<string, unknown> = {
      organizationId,
      status: RecordStatus.ACTIVE,
    };
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        reorderLevel: true,
        category: { select: { name: true } },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category?.name ?? null,
      sellingPrice: safeDecimal(p.sellingPrice),
      reorderLevel: safeDecimal(p.reorderLevel, 3),
    }));
  }

  private async executeProductPricing(
    organizationId: string,
    search?: string,
    categoryId?: string,
    limit = 20,
  ) {
    const where: Record<string, unknown> = {
      organizationId,
      status: RecordStatus.ACTIVE,
    };
    if (categoryId) where.categoryId = categoryId;
    if (search && search.trim().length > 0) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        costPrice: true,
        sellingPrice: true,
        taxRate: true,
      },
      take: limit,
      orderBy: { sellingPrice: 'desc' },
    });

    return products.map((p) => {
      const cost = safeDecimal(p.costPrice);
      const selling = safeDecimal(p.sellingPrice);
      const margin = safeDecimal(selling - cost);
      const marginPercent = selling > 0 ? safeDecimal(((selling - cost) / selling) * 100, 1) : 0;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        costPrice: cost,
        sellingPrice: selling,
        marginAmount: margin,
        marginPercent,
      };
    });
  }

  private async executeProductStock(
    organizationId: string,
    search?: string,
    productId?: string,
    branchId?: string,
    limit = 20,
  ) {
    const whereProduct: Record<string, unknown> = {
      organizationId,
      status: RecordStatus.ACTIVE,
    };
    if (productId) {
      whereProduct.id = productId;
    } else if (search) {
      whereProduct.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { sku: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where: whereProduct,
      include: {
        stockLevels: {
          where: {
            branch: {
              organizationId,
              status: RecordStatus.ACTIVE,
              ...(branchId ? { id: branchId } : {}),
            },
          },
        },
      },
      take: limit,
    });

    return products.map((p) => {
      let totalOnHand = 0;
      let totalReserved = 0;
      for (const lvl of p.stockLevels) {
        totalOnHand += safeDecimal(lvl.quantityOnHand, 3);
        totalReserved += safeDecimal(lvl.quantityReserved, 3);
      }
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        reorderLevel: safeDecimal(p.reorderLevel, 3),
        totalUnitsOnHand: safeDecimal(totalOnHand, 1),
        totalUnitsAvailable: safeDecimal(totalOnHand - totalReserved, 1),
      };
    });
  }

  private async executeProductSummary(organizationId: string) {
    const [totalProducts, activeProducts, inactiveProducts, categoriesCount, brandsCount, avgPriceResult] =
      await Promise.all([
        this.prisma.product.count({ where: { organizationId } }),
        this.prisma.product.count({ where: { organizationId, status: RecordStatus.ACTIVE } }),
        this.prisma.product.count({ where: { organizationId, status: RecordStatus.INACTIVE } }),
        this.prisma.category.count({ where: { organizationId, status: RecordStatus.ACTIVE } }),
        this.prisma.brand.count({ where: { organizationId, status: RecordStatus.ACTIVE } }),
        this.prisma.product.aggregate({
          where: { organizationId, status: RecordStatus.ACTIVE },
          _avg: { sellingPrice: true, costPrice: true },
        }),
      ]);

    const categoriesWithCounts = await this.prisma.category.findMany({
      where: { organizationId, status: RecordStatus.ACTIVE },
      select: {
        name: true,
        _count: { select: { products: true } },
      },
      take: 5,
      orderBy: { products: { _count: 'desc' } },
    });

    return {
      totalProducts,
      activeProducts,
      inactiveProducts,
      categoriesCount,
      brandsCount,
      averageSellingPrice: safeDecimal(avgPriceResult._avg.sellingPrice),
      averageCostPrice: safeDecimal(avgPriceResult._avg.costPrice),
      topCategories: categoriesWithCounts.map((c) => ({
        categoryName: c.name,
        productCount: c._count.products,
      })),
    };
  }
}
