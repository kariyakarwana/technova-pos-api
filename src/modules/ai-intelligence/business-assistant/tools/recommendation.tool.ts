import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import { AiIntelligenceService } from '../../ai-intelligence.service';
import { RecommendationDto, SUPPORTED_RECOMMENDATION_CONTEXTS } from '../../dto/recommendation.dto';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import { ToolRegistryService } from './tool-registry.service';

export interface RecommendationToolParams {
  operation?: 'recommend';
  context?: 'CUSTOMER' | 'PRODUCT' | 'BRANCH' | 'TRENDING' | 'COLD_START' | 'CART_READY';
  topN?: number;
  customerId?: string;
  productId?: string;
  branchId?: string;
  productIds?: string[];
  includeSubstitutes?: boolean;
}

export interface RecommendationItemView {
  product_id: string;
  name: string | null;
  category: string | null;
  brand: string | null;
  price: number | null;
  score: number;
  reason_code?: string;
  reason?: string;
  stock_quantity: number;
  is_available: boolean;
}

export interface RecommendationToolData {
  available: boolean;
  source: string;
  reason?: string;
  context?: string;
  recommendations?: RecommendationItemView[];
  model_metadata?: {
    model_name?: string;
    version?: string;
    context?: string;
    total_candidates_scored?: number;
  };
}

@Injectable()
export class RecommendationTool
  implements IBusinessTool<RecommendationToolParams, RecommendationToolData>
{
  readonly name = 'RecommendationTool';
  readonly description =
    'Provides product recommendations based on collaborative filtering, trending products, customer history, and cart complementary items.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    context: {
      type: 'string',
      description: 'Recommendation context: CUSTOMER, PRODUCT, BRANCH, TRENDING, COLD_START, or CART_READY (Default: TRENDING)',
      enum: ['CUSTOMER', 'PRODUCT', 'BRANCH', 'TRENDING', 'COLD_START', 'CART_READY'],
      required: false,
    },
    topN: {
      type: 'number',
      description: 'Number of recommendations to return (1-20, default: 5)',
      required: false,
    },
    customerId: {
      type: 'string',
      description: 'Customer ID or Customer Number for personalized customer recommendations',
      required: false,
    },
    productId: {
      type: 'string',
      description: 'Product ID or SKU for item similarity / complementary recommendations',
      required: false,
    },
    branchId: {
      type: 'string',
      description: 'Optional branch ID for branch-localized recommendations',
      required: false,
    },
    productIds: {
      type: 'array',
      description: 'List of product IDs currently in cart for CART_READY recommendations',
      required: false,
    },
  };

  private readonly logger = new Logger(RecommendationTool.name);

  constructor(
    @Inject(forwardRef(() => AiIntelligenceService))
    private readonly aiIntelligenceService: AiIntelligenceService,
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(
    params: RecommendationToolParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult<RecommendationToolData>> {
    // 1. Resolve context and topN
    const recContext = params?.context ?? 'TRENDING';
    if (!SUPPORTED_RECOMMENDATION_CONTEXTS.includes(recContext as any)) {
      return {
        success: false,
        error: `Invalid recommendation context: ${recContext}. Supported: ${SUPPORTED_RECOMMENDATION_CONTEXTS.join(', ')}`,
        metadata: { source: 'Recommendation Engine Validation' },
      };
    }

    const rawTopN = params?.topN ?? 5;
    const topN = Math.min(Math.max(Number(rawTopN) || 5, 1), 20);

    // 2. Validate branch scope & authorization
    const requestedBranchId = params?.branchId || context.branchId;
    if (context.branchId && requestedBranchId && context.branchId !== requestedBranchId) {
      return {
        success: false,
        error: `User is restricted to branch ${context.branchId} and cannot query branch ${requestedBranchId}.`,
        metadata: { source: 'Recommendation Engine Authorization' },
      };
    }

    if (requestedBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: {
          id: requestedBranchId,
          organizationId: context.organizationId,
        },
        select: { id: true },
      });
      if (!branch) {
        return {
          success: false,
          error: `Branch not found or does not belong to your organization: ${requestedBranchId}`,
          metadata: { source: 'Recommendation Engine Authorization' },
        };
      }
    }

    // 3. Entity resolution & authorization
    let resolvedCustomerId = params?.customerId;
    if (recContext === 'CUSTOMER') {
      if (!resolvedCustomerId) {
        return {
          success: false,
          error: 'customerId is required when recommendation context is CUSTOMER.',
          metadata: { source: 'Recommendation Engine Validation' },
        };
      }
      const customer = await this.prisma.customer.findFirst({
        where: {
          organizationId: context.organizationId,
          OR: [{ id: resolvedCustomerId }, { customerNumber: resolvedCustomerId }],
        },
        select: { id: true },
      });
      if (!customer) {
        return {
          success: false,
          error: `Customer not found or does not belong to your organization: ${resolvedCustomerId}`,
          metadata: { source: 'Recommendation Engine Authorization' },
        };
      }
      resolvedCustomerId = customer.id;
    }

    let resolvedProductId = params?.productId;
    if (recContext === 'PRODUCT') {
      if (!resolvedProductId) {
        return {
          success: false,
          error: 'productId is required when recommendation context is PRODUCT.',
          metadata: { source: 'Recommendation Engine Validation' },
        };
      }
      const product = await this.prisma.product.findFirst({
        where: {
          organizationId: context.organizationId,
          OR: [{ id: resolvedProductId }, { sku: resolvedProductId }],
        },
        select: { id: true },
      });
      if (!product) {
        return {
          success: false,
          error: `Product not found or does not belong to your organization: ${resolvedProductId}`,
          metadata: { source: 'Recommendation Engine Authorization' },
        };
      }
      resolvedProductId = product.id;
    }

    // 4. Call AI Intelligence Service
    try {
      const dto: RecommendationDto = {
        context: recContext as any,
        top_n: topN,
        branch_id: requestedBranchId,
        customer_id: resolvedCustomerId,
        product_id: resolvedProductId,
        product_ids: params?.productIds,
        include_substitutes: params?.includeSubstitutes,
      };

      const result = await this.aiIntelligenceService.getRecommendations(context.userId, dto);

      const items: RecommendationItemView[] = (result.recommendations || []).map((item) => ({
        product_id: item.product_id,
        name: item.name,
        category: item.category,
        brand: item.brand,
        price: item.price !== null ? Math.round(Number(item.price) * 100) / 100 : null,
        score: Math.round(Number(item.score || 0) * 1000) / 1000,
        reason_code: item.reason_code,
        reason: item.reason,
        stock_quantity: Number(item.stock_quantity || 0),
        is_available: Boolean(item.is_available),
      }));

      return {
        success: true,
        data: {
          available: true,
          source: 'recommendation_engine',
          context: result.context,
          recommendations: items,
          model_metadata: {
            model_name: result.model_metadata?.model_name,
            version: result.model_metadata?.version,
            context: result.model_metadata?.context,
            total_candidates_scored: result.model_metadata?.total_candidates_scored,
          },
        },
        metadata: {
          source: 'Recommendation Engine',
          recordCount: items.length,
          branchId: requestedBranchId,
        },
      };
    } catch (err: unknown) {
      this.logger.warn(`Recommendation service unavailable: ${(err as Error).message}`);
      return {
        success: true,
        data: {
          available: false,
          source: 'recommendation_engine',
          reason: 'AI recommendation service unavailable',
        },
        metadata: {
          source: 'Recommendation Engine (Unavailable)',
          recordCount: 0,
        },
      };
    }
  }
}
