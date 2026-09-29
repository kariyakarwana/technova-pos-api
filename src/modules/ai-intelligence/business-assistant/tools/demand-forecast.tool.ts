import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import { AiIntelligenceService } from '../../ai-intelligence.service';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import { ToolRegistryService } from './tool-registry.service';

export interface DemandForecastToolParams {
  operation?: 'demand_forecast';
  productId?: string;
  horizon?: number;
  branchId?: string;
  category?: string;
}

export interface DailyDemandPredictionView {
  forecast_date: string;
  predicted_units: number;
  is_open?: number;
  is_promo?: number;
}

export interface DemandForecastToolData {
  available: boolean;
  source: string;
  reason?: string;
  horizon?: number;
  product?: {
    id: string;
    sku: string;
    name: string;
  };
  branch?: {
    id: string;
    code: string;
    name: string;
  };
  total_predicted_units?: number;
  average_daily_units?: number;
  peak_day?: {
    date: string;
    units: number;
  };
  forecast_period?: {
    start: string;
    end: string;
  };
  daily_predictions?: DailyDemandPredictionView[];
  model_name?: string;
}

@Injectable()
export class DemandForecastTool
  implements IBusinessTool<DemandForecastToolParams, DemandForecastToolData>
{
  readonly name = 'DemandForecastTool';
  readonly description =
    'Forecasts expected product demand and unit requirements using machine learning for 1, 7, 14, or 30 day horizons.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    productId: {
      type: 'string',
      description: 'Product ID or SKU to forecast demand for (optional, defaults to primary active catalog item)',
      required: false,
    },
    horizon: {
      type: 'number',
      description: 'Forecast horizon in days (must be one of: 1, 7, 14, 30. Default: 7)',
      required: false,
    },
    branchId: {
      type: 'string',
      description: 'Optional branch ID for branch-specific demand prediction',
      required: false,
    },
    category: {
      type: 'string',
      description: 'Optional product category filter or hint',
      required: false,
    },
  };

  private readonly logger = new Logger(DemandForecastTool.name);

  constructor(
    @Inject(forwardRef(() => AiIntelligenceService))
    private readonly aiIntelligenceService: AiIntelligenceService,
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(
    params: DemandForecastToolParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult<DemandForecastToolData>> {
    const horizon = Number(params?.horizon ?? 7);

    // 1. Validate forecast horizon
    if (![1, 7, 14, 30].includes(horizon)) {
      return {
        success: false,
        error: 'Forecast horizon must be one of: 1, 7, 14, 30',
        metadata: { source: 'Demand Forecast Validation' },
      };
    }

    // 2. Validate branch scope & authorization
    const requestedBranchId = params?.branchId || context.branchId;
    if (context.branchId && requestedBranchId && context.branchId !== requestedBranchId) {
      return {
        success: false,
        error: `User is restricted to branch ${context.branchId} and cannot query branch ${requestedBranchId}.`,
        metadata: { source: 'Demand Forecast Authorization' },
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
          metadata: { source: 'Demand Forecast Authorization' },
        };
      }
    }

    // 3. Resolve target product
    let targetProductId = params?.productId;
    let resolvedProduct: { id: string; sku: string; name: string } | null = null;

    if (targetProductId) {
      resolvedProduct = await this.prisma.product.findFirst({
        where: {
          organizationId: context.organizationId,
          OR: [{ id: targetProductId }, { sku: targetProductId }, { name: { contains: targetProductId, mode: 'insensitive' } }],
        },
        select: { id: true, sku: true, name: true },
      });

      if (!resolvedProduct) {
        return {
          success: false,
          error: `Product not found or does not belong to your organization: ${targetProductId}`,
          metadata: { source: 'Demand Forecast Authorization' },
        };
      }
      targetProductId = resolvedProduct.id;
    } else {
      resolvedProduct = await this.prisma.product.findFirst({
        where: {
          organizationId: context.organizationId,
          status: RecordStatus.ACTIVE,
        },
        select: { id: true, sku: true, name: true },
        orderBy: { name: 'asc' },
      });
      if (resolvedProduct) {
        targetProductId = resolvedProduct.id;
      }
    }

    // 4. Call AI Intelligence Service
    try {
      const result = await this.aiIntelligenceService.demandForecast(context.userId, {
        productId: targetProductId,
        branchId: requestedBranchId,
        forecastHorizon: horizon,
        category: params?.category,
      });

      if (!result || !result.predictions || result.predictions.length === 0) {
        return {
          success: true,
          data: {
            available: true,
            source: 'demand_forecast',
            horizon,
            product: result?.product ?? resolvedProduct ?? undefined,
            branch: result?.branch,
            total_predicted_units: 0,
            average_daily_units: 0,
            daily_predictions: [],
          },
          metadata: {
            source: 'Demand Forecast Model',
            recordCount: 0,
            timeRange: `${horizon} days`,
            branchId: result?.branch?.id,
          },
        };
      }

      const totalUnits = result.predictions.reduce(
        (sum, p) => sum + (Number(p.predicted_units) || 0),
        0,
      );
      const avgUnits = totalUnits / result.predictions.length;

      let peakDay = {
        date: result.predictions[0].forecast_date,
        units: Number(result.predictions[0].predicted_units) || 0,
      };

      for (const p of result.predictions) {
        const u = Number(p.predicted_units) || 0;
        if (u > peakDay.units) {
          peakDay = { date: p.forecast_date, units: u };
        }
      }

      const cleanPredictions: DailyDemandPredictionView[] = result.predictions.map((p) => ({
        forecast_date: p.forecast_date,
        predicted_units: Math.round((Number(p.predicted_units) || 0) * 10) / 10,
        is_open: p.is_open,
        is_promo: p.is_promo,
      }));

      return {
        success: true,
        data: {
          available: true,
          source: 'demand_forecast',
          horizon,
          product: result.product ?? resolvedProduct ?? undefined,
          branch: result.branch,
          total_predicted_units: Math.round(totalUnits * 10) / 10,
          average_daily_units: Math.round(avgUnits * 10) / 10,
          peak_day: {
            date: peakDay.date,
            units: Math.round(peakDay.units * 10) / 10,
          },
          forecast_period: {
            start: cleanPredictions[0]?.forecast_date || '',
            end: cleanPredictions[cleanPredictions.length - 1]?.forecast_date || '',
          },
          daily_predictions: cleanPredictions,
          model_name: 'TechNova Augmented Rossmann Demand Model',
        },
        metadata: {
          source: 'Demand Forecast Model',
          recordCount: cleanPredictions.length,
          timeRange: `${horizon} days`,
          branchId: result.branch?.id,
        },
      };
    } catch (err: unknown) {
      this.logger.warn(`Demand forecast service unavailable: ${(err as Error).message}`);
      return {
        success: true,
        data: {
          available: false,
          source: 'demand_forecast',
          reason: 'AI demand forecast service unavailable',
        },
        metadata: {
          source: 'Demand Forecast Model (Unavailable)',
          recordCount: 0,
        },
      };
    }
  }
}
