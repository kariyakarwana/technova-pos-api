import {
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import { AiIntelligenceService } from '../../ai-intelligence.service';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import { ToolRegistryService } from './tool-registry.service';

export interface SalesForecastToolParams {
  operation?: 'sales_forecast';
  horizon?: number;
  branchId?: string;
}

export interface DailyPredictionView {
  date: string;
  predicted_revenue: number;
}

export interface SalesForecastToolData {
  available: boolean;
  source: string;
  reason?: string;
  horizon?: number;
  branch?: {
    id: string;
    code: string;
    name: string;
  };
  total_predicted_revenue?: number;
  average_daily_revenue?: number;
  peak_day?: {
    date: string;
    revenue: number;
  };
  lowest_day?: {
    date: string;
    revenue: number;
  };
  forecast_period?: {
    start: string;
    end: string;
  };
  daily_predictions?: DailyPredictionView[];
  history_days_analyzed?: number;
  model_name?: string;
}

@Injectable()
export class SalesForecastTool
  implements IBusinessTool<SalesForecastToolParams, SalesForecastToolData>
{
  readonly name = 'SalesForecastTool';
  readonly description =
    'Forecasts future store revenue and sales trends using machine learning models for 1, 7, 14, or 30 day horizons.';
  readonly requiredPermissions = ['dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    horizon: {
      type: 'number',
      description: 'Forecast horizon in days (must be one of: 1, 7, 14, 30. Default: 7)',
      required: false,
    },
    branchId: {
      type: 'string',
      description: 'Optional branch ID for branch-specific sales forecasting',
      required: false,
    },
  };

  private readonly logger = new Logger(SalesForecastTool.name);

  constructor(
    @Inject(forwardRef(() => AiIntelligenceService))
    private readonly aiIntelligenceService: AiIntelligenceService,
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(
    params: SalesForecastToolParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult<SalesForecastToolData>> {
    const horizon = Number(params?.horizon ?? 7);

    // 1. Validate forecast horizon
    if (![1, 7, 14, 30].includes(horizon)) {
      return {
        success: false,
        error: 'Forecast horizon must be one of: 1, 7, 14, 30',
        metadata: { source: 'Sales Forecast Validation' },
      };
    }

    // 2. Validate branch scope & authorization
    const requestedBranchId = params?.branchId || context.branchId;
    if (context.branchId && requestedBranchId && context.branchId !== requestedBranchId) {
      return {
        success: false,
        error: `User is restricted to branch ${context.branchId} and cannot query branch ${requestedBranchId}.`,
        metadata: { source: 'Sales Forecast Authorization' },
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
          metadata: { source: 'Sales Forecast Authorization' },
        };
      }
    }

    // 3. Call AI Intelligence Service
    try {
      const result = await this.aiIntelligenceService.salesForecast(context.userId, {
        branchId: requestedBranchId,
        forecastHorizon: horizon,
      });

      if (!result || !result.predictions || result.predictions.length === 0) {
        return {
          success: true,
          data: {
            available: true,
            source: 'sales_forecast',
            horizon,
            total_predicted_revenue: 0,
            average_daily_revenue: 0,
            daily_predictions: [],
            branch: result?.branch,
            history_days_analyzed: result?.historyDays ?? 0,
          },
          metadata: {
            source: 'Sales Forecast Model',
            recordCount: 0,
            timeRange: `${horizon} days`,
            branchId: result?.branch?.id,
          },
        };
      }

      const totalRevenue = result.predictions.reduce(
        (sum, p) => sum + (Number(p.predicted_revenue) || 0),
        0,
      );
      const avgRevenue = totalRevenue / result.predictions.length;

      let peakDay = {
        date: result.predictions[0].date,
        revenue: Number(result.predictions[0].predicted_revenue) || 0,
      };
      let lowestDay = {
        date: result.predictions[0].date,
        revenue: Number(result.predictions[0].predicted_revenue) || 0,
      };

      for (const p of result.predictions) {
        const rev = Number(p.predicted_revenue) || 0;
        if (rev > peakDay.revenue) {
          peakDay = { date: p.date, revenue: rev };
        }
        if (rev < lowestDay.revenue) {
          lowestDay = { date: p.date, revenue: rev };
        }
      }

      const cleanPredictions: DailyPredictionView[] = result.predictions.map((p) => ({
        date: p.date,
        predicted_revenue: Math.round((Number(p.predicted_revenue) || 0) * 100) / 100,
      }));

      return {
        success: true,
        data: {
          available: true,
          source: 'sales_forecast',
          horizon,
          branch: result.branch,
          total_predicted_revenue: Math.round(totalRevenue * 100) / 100,
          average_daily_revenue: Math.round(avgRevenue * 100) / 100,
          peak_day: {
            date: peakDay.date,
            revenue: Math.round(peakDay.revenue * 100) / 100,
          },
          lowest_day: {
            date: lowestDay.date,
            revenue: Math.round(lowestDay.revenue * 100) / 100,
          },
          forecast_period: {
            start: cleanPredictions[0]?.date || '',
            end: cleanPredictions[cleanPredictions.length - 1]?.date || '',
          },
          daily_predictions: cleanPredictions,
          history_days_analyzed: result.historyDays,
          model_name: 'TechNova Multi-Horizon Revenue Model',
        },
        metadata: {
          source: 'Sales Forecast Model',
          recordCount: cleanPredictions.length,
          timeRange: `${horizon} days`,
          branchId: result.branch?.id,
        },
      };
    } catch (err: unknown) {
      this.logger.warn(`Sales forecast service unavailable: ${(err as Error).message}`);
      return {
        success: true,
        data: {
          available: false,
          source: 'sales_forecast',
          reason: 'AI forecast service unavailable',
        },
        metadata: {
          source: 'Sales Forecast Model (Unavailable)',
          recordCount: 0,
        },
      };
    }
  }
}
