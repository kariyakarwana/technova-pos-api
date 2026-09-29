import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecordStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { SalesDataExtractionService } from './sales-forecasting/sales-data-extraction.service';
import { DemandDataExtractionService } from './demand-data-extraction.service';
import {
  DemandForecastOptions,
  DemandForecastResult,
  FastApiDemandForecastPayload,
  FastApiDemandForecastResponse,
} from './interfaces/ai-demand-forecast.interface';
import {
  DailyRevenuePointInput,
  FastApiSalesForecastPayload,
  FastApiSalesForecastResponse,
  FutureCalendarPointInput,
  SalesForecastOptions,
  SalesForecastResult,
} from './interfaces/ai-sales-forecast.interface';
import {
  FastApiRecommendationPayload,
  RecommendationResponse,
} from './interfaces/ai-recommendation.interface';
import {
  RecommendationDto,
  SUPPORTED_RECOMMENDATION_CONTEXTS,
} from './dto/recommendation.dto';

type ModelResponse = Record<string, unknown>;

@Injectable()
export class AiIntelligenceService {
  private readonly logger = new Logger(AiIntelligenceService.name);
  private readonly aiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly salesDataExtraction: SalesDataExtractionService,
    private readonly demandDataExtraction: DemandDataExtractionService,
  ) {
    this.aiUrl = (config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000').replace(/\/$/, '');
  }

  private async organizationId(userId: string): Promise<string> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
      select: { organizationId: true },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organizationId;
  }

  private async post<T extends ModelResponse>(path: string, body: object): Promise<T> {
    try {
      this.logger.log(`Calling AI service: POST ${path}`);
      const response = await fetch(`${this.aiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        let errorDetail = `AI service returned ${response.status}`;
        if (typeof payload.detail === 'string') {
          errorDetail = payload.detail;
        } else if (Array.isArray(payload.detail)) {
          errorDetail = payload.detail
            .map((err: { msg?: string; message?: string }) => err.msg || err.message || JSON.stringify(err))
            .join('; ');
        }
        if (response.status === 400 || response.status === 422) {
          throw new BadRequestException(errorDetail);
        }
        if (response.status === 404) {
          throw new NotFoundException(`AI service resource not found: ${errorDetail}`);
        }
        if (response.status === 503) {
          throw new BadGatewayException(`AI service unavailable: ${errorDetail}`);
        }
        throw new BadGatewayException(`AI service error: ${errorDetail}`);
      }
      return payload as T;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof BadGatewayException
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'AI service is unavailable.';
      throw new BadGatewayException(`AI service unavailable: ${message}`);
    }
  }

  async overview(
    userId: string,
    options: { branchId?: string; forecastDays: number },
  ) {
    const organizationId = await this.organizationId(userId);
    const forecastDays = Math.min(Math.max(Math.round(options.forecastDays), 30), 365);
    if (!Number.isFinite(forecastDays)) throw new BadRequestException('Invalid forecast period.');

    if (options.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: options.branchId, organizationId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Branch not found.');
    }

    const earliest = await this.prisma.sale.findFirst({
      where: {
        branch: { organizationId },
        branchId: options.branchId,
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
      },
      orderBy: { completedAt: 'asc' },
      select: { completedAt: true, createdAt: true },
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const firstSale = earliest?.completedAt ?? earliest?.createdAt;
    const observedDays = firstSale
      ? Math.min(365, Math.max(7, Math.ceil((today.getTime() - firstSale.getTime()) / 86_400_000) + 1))
      : 7;
    const historyStart = new Date(today);
    historyStart.setUTCDate(historyStart.getUTCDate() - observedDays + 1);

    const [branches, customers, products] = await Promise.all([
      this.prisma.branch.findMany({
        where: { organizationId, status: RecordStatus.ACTIVE },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customer.findMany({
        where: { organizationId, status: RecordStatus.ACTIVE },
        select: { id: true, customerNumber: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 200,
      }),
      this.prisma.product.findMany({
        where: { organizationId, status: RecordStatus.ACTIVE },
        select: {
          id: true,
          sku: true,
          name: true,
          costPrice: true,
          sellingPrice: true,
          reorderLevel: true,
          stockLevels: {
            where: options.branchId ? { branchId: options.branchId } : undefined,
            select: { quantityOnHand: true, quantityReserved: true },
          },
          saleItems: {
            where: {
              sale: {
                branchId: options.branchId,
                status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
                createdAt: { gte: historyStart },
              },
            },
            select: {
              quantity: true,
              sale: { select: { id: true, customerId: true, createdAt: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
        take: 30,
      }),
    ]);

    const predictions = await Promise.all(
      products.map(async (product) => {
        const demand = Array.from({ length: observedDays }, () => 0);
        const lastDayOrders = new Set<string>();
        const lastDayCustomers = new Set<string>();
        for (const item of product.saleItems) {
          const saleDate = new Date(item.sale.createdAt);
          saleDate.setUTCHours(0, 0, 0, 0);
          const index = Math.floor((saleDate.getTime() - historyStart.getTime()) / 86_400_000);
          if (index >= 0 && index < demand.length) demand[index] += Number(item.quantity);
          if (index === demand.length - 1) {
            lastDayOrders.add(item.sale.id);
            if (item.sale.customerId) lastDayCustomers.add(item.sale.customerId);
          }
        }
        const currentStock = product.stockLevels.reduce(
          (sum, level) => sum + Number(level.quantityOnHand) - Number(level.quantityReserved),
          0,
        );
        const recent7 = demand.slice(-7);
        const recent28 = demand.slice(-28);
        const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
        const standardDeviation = (values: number[]) => {
          const average = mean(values);
          return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length - 1, 1));
        };
        const common = {
          demand_lag_1: demand.at(-1) ?? 0,
          demand_lag_7: demand.at(-7) ?? 0,
          demand_lag_14: demand.at(-14) ?? 0,
          rolling_mean_7: mean(recent7),
          rolling_mean_28: mean(recent28),
          rolling_std_7: standardDeviation(recent7),
          price_index_28: 1,
          orders_lag_1: lastDayOrders.size,
          customers_lag_1: lastDayCustomers.size,
        };
        const stockBody = {
          product_id: product.id,
          start_date: today.toISOString().slice(0, 10),
          forecast_days: forecastDays,
          recent_daily_demand: demand,
          current_stock: Math.max(currentStock, 0),
          lead_time_days: 7,
          review_period_days: 14,
          service_level: 0.95,
          unit_price: Math.max(Number(product.sellingPrice), 0.01),
          ...common,
        };
        const pricingBody = {
          product_id: product.id,
          pricing_date: today.toISOString().slice(0, 10),
          current_price: Math.max(Number(product.sellingPrice), 0.01),
          unit_cost: Math.max(Math.min(Number(product.costPrice), Number(product.sellingPrice) - 0.01), 0.01),
          min_margin_rate: 0.1,
          max_change_rate: 0.15,
          candidate_steps: 13,
          ...common,
        };
        let forecast: Record<string, unknown>;
        try {
          forecast = await this.post<Record<string, unknown>>(
            '/v1/inventory/forecast/multi-horizon',
            stockBody,
          );
        } catch (error) {
          if (
            error instanceof BadGatewayException &&
            (error.message.startsWith('AI service unavailable:') ||
              error.message.includes('stock_intelligence') ||
              (error.message.includes('model.joblib') && error.message.includes('not found')))
          ) {
            this.logger.warn(
              `Stock intelligence unavailable for product ${product.id}: ${error.message}. Providing local inventory facts fallback.`,
            );
            forecast = {
              summary: {
                forecast_days: forecastDays,
                total_predicted_demand: 0,
                average_daily_demand: 0,
                next_7_days_demand: 0,
                next_30_days_demand: 0,
                peak_demand_date: today.toISOString().slice(0, 10),
                peak_daily_demand: 0,
              },
              stock_plan: {
                current_stock: Math.max(currentStock, 0),
                lead_time_demand: 0,
                safety_stock: 0,
                reorder_point: Number(product.reorderLevel) || 0,
                target_stock: Number(product.reorderLevel) || 0,
                recommended_order_quantity: Math.max(
                  (Number(product.reorderLevel) || 0) - currentStock,
                  0,
                ),
                stockout_risk:
                  currentStock <= 0
                    ? 1.0
                    : currentStock <= (Number(product.reorderLevel) || 0)
                      ? 0.75
                      : 0.0,
                status:
                  currentStock <= (Number(product.reorderLevel) || 0)
                    ? 'reorder_now'
                    : 'healthy',
              },
              data_readiness: {
                history_days: observedDays,
                maturity: 'ai_unavailable',
                confidence: 'none',
                production_ready: false,
                recommended_action:
                  'AI predictive stock intelligence unavailable. Showing local inventory thresholds.',
              },
              daily: [],
              weekly: [],
              monthly: [],
              seasonal: [],
              yearly: [],
              notes: [
                'AI predictive stock intelligence model is not installed.',
                'Values reflect direct POS inventory facts and reorder thresholds.',
              ],
            };
          } else {
            throw error;
          }
        }

        let pricing: Record<string, unknown> | null = null;
        if (
          Number(product.sellingPrice) > Number(product.costPrice) &&
          Number(product.costPrice) > 0
        ) {
          try {
            pricing = await this.post<Record<string, unknown>>(
              '/v1/pricing/recommend',
              pricingBody,
            );
          } catch (error) {
            if (
              error instanceof BadGatewayException &&
              (error.message.startsWith('AI service unavailable:') ||
                error.message.includes('dynamic_pricing') ||
                (error.message.includes('model.joblib') && error.message.includes('not found')))
            ) {
              this.logger.warn(
                `Dynamic pricing unavailable for product ${product.id}: ${error.message}`,
              );
              pricing = null;
            } else {
              throw error;
            }
          }
        }

        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          currentStock,
          reorderLevel: Number(product.reorderLevel),
          currentPrice: Number(product.sellingPrice),
          observedDays,
          forecast,
          pricing,
        };
      }),
    );

    const hasAiStock = predictions.some(
      (p) =>
        (p.forecast as any)?.data_readiness?.maturity !== 'ai_unavailable' &&
        ((p.forecast as any)?.summary?.total_predicted_demand ?? 0) > 0,
    );
    const hasAiPricing = predictions.some((p) => p.pricing !== null);

    return {
      generatedAt: new Date().toISOString(),
      modelStatus: 'connected',
      forecastDays,
      observedDays,
      branches,
      customers,
      products: predictions,
      stockIntelligence: {
        available: hasAiStock,
        source: hasAiStock ? 'ai_model' : 'inventory_fallback',
        message: hasAiStock
          ? 'Predictive stock intelligence model connected.'
          : 'Predictive stock intelligence model is not currently installed. Displaying local inventory status.',
      },
      dynamicPricing: {
        available: hasAiPricing,
        source: hasAiPricing ? 'ai_model' : 'pricing_unavailable',
        message: hasAiPricing
          ? 'Dynamic pricing model connected.'
          : 'Dynamic pricing model is not currently installed.',
      },
    };
  }

  async loyalty(userId: string, customerId: string, topK: number) {
    const organizationId = await this.organizationId(userId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true, customerNumber: true, firstName: true, lastName: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    const recommendation = await this.post<Record<string, unknown>>(
      '/v1/loyalty/recommendations',
      { customer_id: customer.id, top_k: Math.min(Math.max(Math.round(topK), 1), 10) },
    );
    return { customer, ...recommendation };
  }

  async salesForecast(
    userId: string,
    options: SalesForecastOptions = {},
  ): Promise<SalesForecastResult> {
    const horizon = options.forecastHorizon ?? 7;
    if (![1, 7, 14, 30].includes(horizon)) {
      throw new BadRequestException('Forecast horizon must be one of: 1, 7, 14, 30');
    }

    const organizationId = await this.organizationId(userId);

    let targetBranch: { id: string; code: string; name: string } | null = null;
    if (options.branchId) {
      targetBranch = await this.prisma.branch.findFirst({
        where: { id: options.branchId, organizationId },
        select: { id: true, code: true, name: true },
      });
      if (!targetBranch) throw new NotFoundException('Branch not found.');
    } else {
      targetBranch = await this.prisma.branch.findFirst({
        where: { organizationId, status: RecordStatus.ACTIVE },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      });
      if (!targetBranch) {
        throw new NotFoundException('No active branch found for organization.');
      }
    }

    const nowColomboStr = this.salesDataExtraction.formatInColombo(new Date());
    const baseDateToday = new Date(`${nowColomboStr}T00:00:00+05:30`);
    const ninetyDaysAgo = new Date(baseDateToday);
    ninetyDaysAgo.setDate(baseDateToday.getDate() - 100);

    const dailyRevenueRows = await this.salesDataExtraction.buildDataset(
      organizationId,
      {
        branchId: targetBranch.id,
        startDate: ninetyDaysAgo,
      },
    );

    dailyRevenueRows.sort((a, b) => a.date.localeCompare(b.date));

    const recentDailyRevenue: DailyRevenuePointInput[] = dailyRevenueRows
      .slice(-90)
      .map((row) => ({
        date: row.date,
        revenue: row.daily_revenue,
        is_operating_day: row.is_operating_day,
      }));

    if (
      !recentDailyRevenue.length ||
      !recentDailyRevenue.some((row) => row.revenue > 0)
    ) {
      throw new BadRequestException('Insufficient historical data');
    }

    const baseDateStr =
      dailyRevenueRows.length > 0
        ? dailyRevenueRows[dailyRevenueRows.length - 1].date
        : this.salesDataExtraction.formatInColombo(new Date());

    const baseDate = new Date(`${baseDateStr}T12:00:00+05:30`);

    const activeDiscountRules = await this.prisma.discountRule.findMany({
      where: {
        organizationId,
        status: RecordStatus.ACTIVE,
      },
      select: {
        startsAt: true,
        endsAt: true,
      },
    });

    const operatesOnSunday = dailyRevenueRows.some(
      (row) => row.day_of_week === 6 && row.daily_revenue > 0,
    );

    const futureCalendar: FutureCalendarPointInput[] = [];
    for (let h = 0; h < horizon; h++) {
      const targetDay = new Date(baseDate);
      targetDay.setDate(baseDate.getDate() + 1 + h);
      const dateStr = this.salesDataExtraction.formatInColombo(targetDay);

      const jsDay = targetDay.getUTCDay();
      const isSunday = jsDay === 0;
      const isOperatingDay = isSunday ? (operatesOnSunday ? 1 : 0) : 1;

      const dayStart = new Date(`${dateStr}T00:00:00+05:30`);
      const dayEnd = new Date(`${dateStr}T23:59:59.999+05:30`);

      const matchingDiscounts = activeDiscountRules.filter((rule) => {
        const afterStart = !rule.startsAt || rule.startsAt <= dayEnd;
        const beforeEnd = !rule.endsAt || rule.endsAt >= dayStart;
        return afterStart && beforeEnd;
      }).length;

      futureCalendar.push({
        date: dateStr,
        is_operating_day: isOperatingDay,
        active_discounts: matchingDiscounts,
      });
    }

    const payload: FastApiSalesForecastPayload = {
      organization_id: organizationId,
      branch_id: targetBranch.id,
      forecast_horizon: horizon,
      recent_daily_revenue: recentDailyRevenue,
      future_calendar: futureCalendar,
    };

    const forecastResponse = await this.post<FastApiSalesForecastResponse>(
      '/v1/sales-forecast/forecast',
      payload,
    );

    return {
      ...forecastResponse,
      branch: {
        id: targetBranch.id,
        code: targetBranch.code,
        name: targetBranch.name,
      },
      generatedAt: new Date().toISOString(),
      historyDays: recentDailyRevenue.length,
    };
  }

  async demandForecast(
    userId: string,
    options: DemandForecastOptions = {},
  ): Promise<DemandForecastResult> {
    const horizon = options.horizon ?? options.forecastHorizon ?? 7;
    if (![1, 7, 14, 30].includes(horizon)) {
      throw new BadRequestException('Forecast horizon must be one of: 1, 7, 14, 30');
    }

    const organizationId = await this.organizationId(userId);

    const branchQueryId = options.branchId ?? options.storeId ?? options.store_id;
    let targetBranch: { id: string; code: string; name: string } | null = null;
    if (branchQueryId) {
      targetBranch = await this.prisma.branch.findFirst({
        where: { id: branchQueryId, organizationId },
        select: { id: true, code: true, name: true },
      });
      if (!targetBranch) {
        throw new NotFoundException('Branch not found.');
      }
    } else {
      targetBranch = await this.prisma.branch.findFirst({
        where: { organizationId, status: RecordStatus.ACTIVE },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      });
      if (!targetBranch) {
        throw new NotFoundException('No active branch found for organization.');
      }
    }

    const productQueryId = options.productId ?? options.product_id;
    if (!productQueryId) {
      throw new BadRequestException('Product ID is required for demand forecasting.');
    }

    const targetProduct = await this.prisma.product.findFirst({
      where: {
        organizationId,
        OR: [{ id: productQueryId }, { sku: productQueryId }],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        sellingPrice: true,
        category: { select: { name: true } },
      },
    });

    if (!targetProduct) {
      throw new NotFoundException('Product not found.');
    }

    // Require real historical sales for this product and branch
    const historicalSalesCount = await this.prisma.saleItem.count({
      where: {
        productId: targetProduct.id,
        sale: {
          branch: { organizationId },
          branchId: targetBranch.id,
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        },
      },
    });

    if (historicalSalesCount === 0) {
      throw new BadRequestException('Insufficient historical data');
    }

    const productId = targetProduct.sku || targetProduct.id;
    const storeId = targetBranch.id;
    const category = targetProduct.category?.name || options.category || 'General';
    const baseUnitPrice =
      options.base_unit_price ??
      options.baseUnitPrice ??
      this.demandDataExtraction.safeDecimalToNumber(targetProduct.sellingPrice);
    if (!baseUnitPrice || baseUnitPrice <= 0) {
      throw new BadRequestException('Product selling price must be greater than 0.');
    }
    const unitPrice = options.unit_price ?? options.unitPrice ?? baseUnitPrice;
    const storeType = options.store_type ?? options.storeType ?? 'a';
    const assortment = options.assortment ?? 'a';
    const promo2 = options.promo2 ?? 0;

    let forecastDate = options.forecast_date ?? options.forecastDate;
    if (!forecastDate) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      forecastDate = this.demandDataExtraction.formatInColombo(tomorrow);
    }

    const rawContexts = options.daily_contexts ?? options.dailyContexts;
    const dailyContexts = rawContexts?.map((ctx) => {
      const anyCtx = ctx as any;
      const c = {
        forecast_date: ctx.forecast_date ?? anyCtx.forecastDate ?? anyCtx.date,
        is_open: ctx.is_open ?? anyCtx.isOpen ?? 1,
        is_promo: ctx.is_promo ?? anyCtx.isPromo ?? 0,
        unit_price: ctx.unit_price ?? anyCtx.unitPrice,
        state_holiday: (ctx.state_holiday ?? anyCtx.stateHoliday)
          ? String(ctx.state_holiday ?? anyCtx.stateHoliday)
          : '0',
        school_holiday: ctx.school_holiday ?? anyCtx.schoolHoliday ?? 0,
      };
      delete (c as unknown as Record<string, unknown>).customers;
      return c;
    });

    const payload: FastApiDemandForecastPayload = {
      product_id: String(productId),
      store_id: String(storeId),
      category: String(category),
      base_unit_price: Number(baseUnitPrice),
      unit_price: Number(unitPrice),
      store_type: String(storeType),
      assortment: String(assortment),
      promo2: Number(promo2),
      horizon: Number(horizon),
      forecast_date: String(forecastDate),
      has_historical_data: true,
      ...(dailyContexts && dailyContexts.length > 0 ? { daily_contexts: dailyContexts } : {}),
    };

    // Guarantee customers is strictly forbidden and never sent
    delete (payload as unknown as Record<string, unknown>).customers;

    this.logger.log(
      `Executing Demand Forecast for product ${productId} at store ${storeId} over horizon ${horizon}`,
    );

    const forecastResponse = await this.post<FastApiDemandForecastResponse>(
      '/v1/demand-forecast/forecast',
      payload,
    );

    if (!forecastResponse || !Array.isArray(forecastResponse.predictions)) {
      throw new BadGatewayException('AI service returned a malformed response.');
    }

    return {
      ...forecastResponse,
      ...(targetBranch
        ? {
            branch: {
              id: targetBranch.id,
              code: targetBranch.code,
              name: targetBranch.name,
            },
          }
        : {}),
      ...(targetProduct
        ? {
            product: {
              id: targetProduct.id,
              sku: targetProduct.sku,
              name: targetProduct.name,
            },
          }
        : {}),
      generatedAt: new Date().toISOString(),
    };
  }

  async getRecommendations(
    userId: string,
    dto: RecommendationDto,
  ): Promise<RecommendationResponse> {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('Request body must be provided.');
    }

    // 1. Validate authenticated tenant
    const organizationId = await this.organizationId(userId);

    // 2. Validate and normalize context
    let context = dto.context;
    if ((context as string) === 'POPULAR') {
      context = 'COLD_START';
    }
    if (!context || !SUPPORTED_RECOMMENDATION_CONTEXTS.includes(context as any)) {
      throw new BadRequestException(
        `Invalid recommendation context: ${context}. Supported contexts are: ${SUPPORTED_RECOMMENDATION_CONTEXTS.join(', ')}`,
      );
    }

    // 3. Validate top_n
    const rawTopN = dto.top_n ?? dto.topN ?? 5;
    const topN = Number(rawTopN);
    if (!Number.isInteger(topN) || topN < 1 || topN > 20) {
      throw new BadRequestException('top_n must be an integer between 1 and 20.');
    }

    const branchId = (dto.branch_id ?? dto.branchId)?.trim() || undefined;
    const customerId = (dto.customer_id ?? dto.customerId)?.trim() || undefined;
    const productId = (dto.product_id ?? dto.productId)?.trim() || undefined;
    const rawProductIds = dto.product_ids ?? dto.productIds;
    let productIds: string[] | undefined = undefined;

    // 4. Context-specific validation & entity authorization
    let authorizedCustomer: { id: string; customerNumber: string; organizationId: string } | null = null;
    let targetProduct: {
      id: string;
      sku: string;
      name: string;
      sellingPrice: any;
      category?: { name: string } | null;
      brand?: { name: string } | null;
    } | null = null;

    if (context === 'PRODUCT') {
      if (!productId) {
        throw new BadRequestException('product_id is required when context is PRODUCT.');
      }
      const product = await this.prisma.product.findFirst({
        where: {
          organizationId,
          OR: [{ id: productId }, { sku: productId }],
        },
        select: {
          id: true,
          sku: true,
          name: true,
          sellingPrice: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
          organizationId: true,
        },
      });
      if (!product || (product.organizationId && product.organizationId !== organizationId)) {
        throw new NotFoundException(`Product not found: ${productId}`);
      }
      targetProduct = product;
    } else if (context === 'CUSTOMER') {
      if (!customerId) {
        throw new BadRequestException('customer_id is required when context is CUSTOMER.');
      }
      const customer = await this.prisma.customer.findFirst({
        where: {
          organizationId,
          OR: [{ id: customerId }, { customerNumber: customerId }],
        },
        select: { id: true, customerNumber: true, organizationId: true },
      });
      if (!customer || (customer.organizationId && customer.organizationId !== organizationId)) {
        throw new NotFoundException(`Customer not found: ${customerId}`);
      }
      authorizedCustomer = customer;
    } else if (context === 'CART_READY') {
      if (!rawProductIds || !Array.isArray(rawProductIds) || rawProductIds.length === 0) {
        throw new BadRequestException(
          'product_ids must be a non-empty array of product IDs when context is CART_READY.',
        );
      }
      productIds = rawProductIds.map((id) => (typeof id === 'string' ? id.trim() : ''));
      if (productIds.some((id) => !id)) {
        throw new BadRequestException(
          'Invalid product_ids array: all elements must be non-empty strings.',
        );
      }
      for (const pid of productIds) {
        const product = await this.prisma.product.findFirst({
          where: {
            organizationId,
            OR: [{ id: pid }, { sku: pid }],
          },
          select: { id: true, sku: true, organizationId: true },
        });
        if (!product || (product.organizationId && product.organizationId !== organizationId)) {
          throw new NotFoundException(`Product not found: ${pid}`);
        }
      }
    } else if (context === 'BRANCH') {
      if (!branchId) {
        throw new BadRequestException('branch_id is required when context is BRANCH.');
      }
    }

    // 5. Branch authorization if provided in any context
    let authorizedBranch: { id: string; code: string; organizationId: string } | null = null;
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: {
          organizationId,
          OR: [{ id: branchId }, { code: branchId }],
        },
        select: { id: true, code: true, organizationId: true },
      });
      if (!branch || (branch.organizationId && branch.organizationId !== organizationId)) {
        throw new NotFoundException(`Branch not found: ${branchId}`);
      }
      authorizedBranch = branch;
    }

    // 6. Context-specific historical sales data verification (no synthetic/fallback recommendations)
    if (context === 'BRANCH') {
      if (!authorizedBranch) {
        throw new BadRequestException('branch_id is required when context is BRANCH.');
      }
      const branchSalesCount = await this.prisma.sale.count({
        where: {
          branch: { organizationId },
          branchId: authorizedBranch.id,
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        },
      });

      if (branchSalesCount === 0) {
        throw new BadRequestException('Insufficient historical data');
      }
    } else if (context === 'CUSTOMER') {
      if (!authorizedCustomer) {
        throw new BadRequestException('customer_id is required when context is CUSTOMER.');
      }
      const customerSalesCount = await this.prisma.sale.count({
        where: {
          branch: { organizationId },
          customerId: authorizedCustomer.id,
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        },
      });

      if (customerSalesCount === 0) {
        throw new BadRequestException('Insufficient historical data');
      }
    } else if (context === 'TRENDING') {
      const trendingSalesCount = await this.prisma.sale.count({
        where: {
          branch: { organizationId },
          ...(authorizedBranch ? { branchId: authorizedBranch.id } : {}),
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        },
      });

      if (trendingSalesCount === 0) {
        throw new BadRequestException('Insufficient historical data');
      }
    } else if (context === 'COLD_START') {
      const orgSalesCount = await this.prisma.sale.count({
        where: {
          branch: { organizationId },
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        },
      });

      if (orgSalesCount === 0) {
        throw new BadRequestException('Insufficient historical data');
      }
    }

    // 7. Build FastAPI payload (strictly forward only required anonymized fields, no PII)
    const payload: FastApiRecommendationPayload = {
      organization_id: organizationId,
      context,
      top_n: topN,
      include_substitutes: Boolean(dto.include_substitutes ?? dto.includeSubstitutes ?? false),
      ...(authorizedBranch ? { branch_id: authorizedBranch.id } : (branchId ? { branch_id: branchId } : {})),
      ...(authorizedCustomer ? { customer_id: authorizedCustomer.id } : (customerId ? { customer_id: customerId } : {})),
      ...(productId ? { product_id: targetProduct ? (targetProduct.sku || targetProduct.id) : productId } : {}),
      ...(productIds && productIds.length > 0 ? { product_ids: productIds } : {}),
      ...(targetProduct?.category?.name ? { category: targetProduct.category.name } : {}),
      ...(targetProduct?.name ? { product_name: targetProduct.name } : {}),
      ...(targetProduct?.brand?.name ? { brand: targetProduct.brand.name } : {}),
      ...(targetProduct?.sellingPrice ? { price: Number(targetProduct.sellingPrice) } : {}),
    };

    this.logger.log(
      `Executing Recommendations for organization ${organizationId}, context ${context}, top_n ${topN}`,
    );

    // 7. Call FastAPI
    const response = await this.post<RecommendationResponse>(
      '/v1/recommendations/recommend',
      payload,
    );

    if (!response || !Array.isArray(response.recommendations)) {
      throw new BadGatewayException('AI service returned a malformed recommendation response.');
    }

    // 8. Map and return clean response
    return {
      context: response.context,
      organization_id: response.organization_id || organizationId,
      branch_id: response.branch_id ?? (branchId || null),
      recommendations: response.recommendations.map((item) => ({
        product_id: item.product_id,
        name: item.name ?? null,
        category: item.category ?? null,
        brand: item.brand ?? null,
        price: item.price !== undefined && item.price !== null ? Number(item.price) : null,
        score: Number(item.score ?? 0),
        reason_code: item.reason_code,
        reason: item.reason,
        stock_quantity: Number(item.stock_quantity ?? 0),
        is_available: Boolean(item.is_available),
      })),
      generated_at: response.generated_at || new Date().toISOString(),
      model_metadata: {
        model_name: response.model_metadata?.model_name || 'TechNova Hybrid Recommender',
        version: response.model_metadata?.version || '1.0.0',
        algorithms_used: response.model_metadata?.algorithms_used || [],
        context: response.model_metadata?.context || context,
        total_candidates_scored: Number(response.model_metadata?.total_candidates_scored ?? 0),
        training_date_range: response.model_metadata?.training_date_range || {},
      },
    };
  }
}
