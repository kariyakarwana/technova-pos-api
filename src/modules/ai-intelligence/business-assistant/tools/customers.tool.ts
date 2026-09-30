import { Injectable, Logger } from '@nestjs/common';
import { RecordStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma/prisma.service';
import {
  IBusinessTool,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from './business-tool.interface';
import { formatColomboDate, safeDecimal } from './date-utils';
import { ToolRegistryService } from './tool-registry.service';

export type CustomerOperation =
  | 'customer_summary'
  | 'customer_search'
  | 'customer_purchase_summary'
  | 'customer_activity';

export interface CustomersToolParams {
  operation?: CustomerOperation;
  customerId?: string;
  customerNumber?: string;
  search?: string;
  limit?: number;
}

@Injectable()
export class CustomersTool implements IBusinessTool<CustomersToolParams> {
  readonly name = 'CustomersTool';
  readonly description = 'Queries customer counts, safe customer purchase summaries, and top customer metrics. Customer PII (phone, email, address) is strictly excluded.';
  readonly requiredPermissions = ['customers:view', 'dashboard:view'];

  readonly parameterSchema: Record<string, ToolParameterSchema> = {
    operation: {
      type: 'string',
      description: 'The customer query operation: customer_summary, customer_search, customer_purchase_summary, or customer_activity',
      required: true,
      enum: ['customer_summary', 'customer_search', 'customer_purchase_summary', 'customer_activity'],
    },
    customerId: {
      type: 'string',
      description: 'Optional customer ID for purchase lookup',
      required: false,
    },
    customerNumber: {
      type: 'string',
      description: 'Optional customer number for lookup',
      required: false,
    },
    search: {
      type: 'string',
      description: 'Search term matching customer name or number (PII searches disallowed)',
      required: false,
    },
    limit: {
      type: 'number',
      description: 'Max records to return (default 10, max 50)',
      required: false,
    },
  };

  private readonly logger = new Logger(CustomersTool.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {
    this.registry.register(this);
  }

  async execute(params: CustomersToolParams, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const operation = params.operation ?? 'customer_summary';
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);

    try {
      let data: unknown;
      let recordCount = 0;

      switch (operation) {
        case 'customer_summary': {
          const summary = await this.executeCustomerSummary(context.organizationId);
          data = summary;
          recordCount = summary.totalCustomers;
          break;
        }

        case 'customer_search': {
          const results = await this.executeCustomerSearch(context.organizationId, params.search, limit);
          data = results;
          recordCount = results.length;
          break;
        }

        case 'customer_purchase_summary': {
          const purchaseSummary = await this.executeCustomerPurchaseSummary(
            context.organizationId,
            params.customerId,
            params.customerNumber,
          );
          data = purchaseSummary;
          recordCount = purchaseSummary ? 1 : 0;
          break;
        }

        case 'customer_activity': {
          const topSpenders = await this.executeCustomerActivity(context.organizationId, limit);
          data = topSpenders;
          recordCount = topSpenders.length;
          break;
        }

        default:
          return {
            success: false,
            error: 'Unsupported customer operation. Supported operations are: customer_summary, customer_search, customer_purchase_summary, customer_activity.',
          };
      }

      return {
        success: true,
        data,
        metadata: {
          source: 'CustomersDatabase',
          recordCount,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`CustomersTool failed executing operation "${operation}"`, err);
      return {
        success: false,
        error: 'An internal error occurred while retrieving customer records.',
      };
    }
  }

  private async executeCustomerSummary(organizationId: string) {
    const [totalCustomers, activeCustomers, inactiveCustomers] = await Promise.all([
      this.prisma.customer.count({ where: { organizationId } }),
      this.prisma.customer.count({ where: { organizationId, status: RecordStatus.ACTIVE } }),
      this.prisma.customer.count({ where: { organizationId, status: RecordStatus.INACTIVE } }),
    ]);

    // Count customers with at least one completed sale
    const customersWithSales = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        branch: { organizationId },
        customerId: { not: null },
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
      },
    });

    return {
      totalCustomers,
      activeCustomers,
      inactiveCustomers,
      customersWithSalesCount: customersWithSales.length,
      note: 'Customer personal identifying information (PII) is masked by policy.',
    };
  }

  private async executeCustomerSearch(organizationId: string, search?: string, limit = 10) {
    const where: Record<string, unknown> = {
      organizationId,
      status: RecordStatus.ACTIVE,
    };

    if (search && search.trim().length > 0) {
      const term = search.trim();
      where.OR = [
        { customerNumber: { equals: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
      ];
    }

    // STRICT: Select ONLY non-PII fields
    const customers = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        customerNumber: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return customers.map((c) => ({
      customerId: c.id,
      customerNumber: c.customerNumber,
      displayName: `${c.firstName} ${c.lastName ?? ''}`.trim(),
      status: c.status,
      memberSince: formatColomboDate(c.createdAt),
    }));
  }

  private async executeCustomerPurchaseSummary(
    organizationId: string,
    customerId?: string,
    customerNumber?: string,
  ) {
    if (!customerId && !customerNumber) {
      return null;
    }

    const where: Record<string, unknown> = { organizationId };
    if (customerId) where.id = customerId;
    if (customerNumber) where.customerNumber = customerNumber;

    const customer = await this.prisma.customer.findFirst({
      where,
      select: {
        id: true,
        customerNumber: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
      },
    });

    if (!customer) return null;

    const sales = await this.prisma.sale.findMany({
      where: {
        customerId: customer.id,
        branch: { organizationId },
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
      },
      select: {
        total: true,
        completedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    let totalSpend = 0;
    for (const s of sales) {
      totalSpend += safeDecimal(s.total);
    }

    const orderCount = sales.length;
    const averageOrderValue = orderCount > 0 ? safeDecimal(totalSpend / orderCount) : 0;
    const firstSale = sales[0];
    const lastSale = sales[sales.length - 1];

    return {
      customerId: customer.id,
      customerNumber: customer.customerNumber,
      displayName: `${customer.firstName} ${customer.lastName ?? ''}`.trim(),
      status: customer.status,
      totalSpend: safeDecimal(totalSpend),
      orderCount,
      averageOrderValue,
      firstPurchaseDate: firstSale ? formatColomboDate(firstSale.completedAt ?? firstSale.createdAt) : null,
      lastPurchaseDate: lastSale ? formatColomboDate(lastSale.completedAt ?? lastSale.createdAt) : null,
    };
  }

  private async executeCustomerActivity(organizationId: string, limit = 10) {
    // Group completed sales by customerId
    const topSpenderGroups = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        branch: { organizationId },
        customerId: { not: null },
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
      },
      _sum: { total: true },
      _count: { id: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    });

    if (topSpenderGroups.length === 0) return [];

    const validCustomerIds = topSpenderGroups
      .map((g) => g.customerId)
      .filter((id): id is string => Boolean(id));

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: validCustomerIds }, organizationId },
      select: {
        id: true,
        customerNumber: true,
        firstName: true,
        lastName: true,
      },
    });

    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return topSpenderGroups
      .map((g) => {
        if (!g.customerId) return null;
        const cust = customerMap.get(g.customerId);
        const spend = safeDecimal(g._sum.total);
        const orders = g._count.id;
        return {
          customerId: g.customerId,
          customerNumber: cust?.customerNumber ?? 'N/A',
          displayName: cust ? `${cust.firstName} ${cust.lastName ?? ''}`.trim() : 'Unknown Customer',
          totalSpent: spend,
          orderCount: orders,
          averageOrderValue: orders > 0 ? safeDecimal(spend / orders) : 0,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
}
