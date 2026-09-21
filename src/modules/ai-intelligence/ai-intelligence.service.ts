import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecordStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

type ModelResponse = Record<string, unknown>;

@Injectable()
export class AiIntelligenceService {
  private readonly aiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
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
      const response = await fetch(`${this.aiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof payload.detail === 'string' ? payload.detail : `AI service returned ${response.status}`);
      }
      return payload as T;
    } catch (error) {
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
        const [forecast, pricing] = await Promise.all([
          this.post<Record<string, unknown>>('/v1/inventory/forecast/multi-horizon', stockBody),
          Number(product.sellingPrice) > Number(product.costPrice) && Number(product.costPrice) > 0
            ? this.post<Record<string, unknown>>('/v1/pricing/recommend', pricingBody)
            : Promise.resolve(null),
        ]);
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

    return {
      generatedAt: new Date().toISOString(),
      modelStatus: 'connected',
      forecastDays,
      observedDays,
      branches,
      customers,
      products: predictions,
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
}
