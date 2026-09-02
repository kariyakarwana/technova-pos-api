import { Injectable, NotFoundException } from '@nestjs/common';
import { CreditStatus, PaymentStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { ReportFilterDto } from './dto/report.dto';
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}
  private async org(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  private dates(q: ReportFilterDto) {
    const to = q.to ? new Date(q.to) : new Date(),
      from = q.from
        ? new Date(q.from)
        : new Date(to.getTime() - 30 * 24 * 60 * 60_000);
    return { from, to };
  }
  private async scope(userId: string, q: ReportFilterDto) {
    const organizationId = await this.org(userId);
    if (
      q.branchId &&
      !(await this.prisma.branch.findFirst({
        where: { id: q.branchId, organizationId },
      }))
    )
      throw new NotFoundException('Branch not found.');
    return organizationId;
  }
  async dashboard(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q),
      { from, to } = this.dates(q),
      saleWhere = {
        branch: { organizationId },
        branchId: q.branchId,
        status: {
          in: [
            SaleStatus.COMPLETED,
            SaleStatus.PARTIALLY_REFUNDED,
            SaleStatus.REFUNDED,
          ],
        },
        createdAt: { gte: from, lte: to },
      };
    const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
    const completedStatuses = [
      SaleStatus.COMPLETED,
      SaleStatus.PARTIALLY_REFUNDED,
      SaleStatus.REFUNDED,
    ];
    const [sales, customers, lowStock, credit, refunds, previousSales, previousRefunds, suppliers, purchases, previousPurchases, saleRows, topCustomers, categories, productCount] = await Promise.all([
      this.prisma.sale.aggregate({
        where: saleWhere,
        _count: { _all: true },
        _sum: { total: true, paidTotal: true, balanceDue: true },
      }),
      this.prisma.customer.count({ where: { organizationId } }),
      this.lowStock(userId, q.branchId),
      this.prisma.creditAgreement.aggregate({
        where: {
          customer: { organizationId },
          status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
        },
        _sum: { outstandingBalance: true },
        _count: { _all: true },
      }),
      this.prisma.return.aggregate({
        where: {
          sale: { branch: { organizationId }, branchId: q.branchId },
          createdAt: { gte: from, lte: to },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.sale.aggregate({
        where: { ...saleWhere, createdAt: { gte: previousFrom, lt: from } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.return.aggregate({
        where: { sale: { branch: { organizationId }, branchId: q.branchId }, createdAt: { gte: previousFrom, lt: from } },
        _sum: { total: true },
      }),
      this.prisma.supplier.count({ where: { organizationId } }),
      this.prisma.purchaseOrder.aggregate({
        where: { branch: { organizationId }, branchId: q.branchId, createdAt: { gte: from, lte: to } },
        _count: { _all: true }, _sum: { total: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: { branch: { organizationId }, branchId: q.branchId, createdAt: { gte: previousFrom, lt: from } },
        _sum: { total: true },
      }),
      this.prisma.sale.findMany({
        where: { branch: { organizationId }, branchId: q.branchId, status: { in: completedStatuses }, createdAt: { gte: from, lte: to } },
        select: {
          id: true, invoiceNumber: true, status: true, total: true, createdAt: true,
          customerId: true,
          customer: { select: { firstName: true, lastName: true, address: true } },
          items: {
            select: {
              quantity: true,
              lineTotal: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  costPrice: true,
                  sellingPrice: true,
                  categoryId: true,
                  category: { select: { name: true } },
                  images: { orderBy: { position: 'asc' }, take: 1 },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.findMany({
        where: { organizationId },
        select: { id: true, firstName: true, lastName: true, address: true, createdAt: true, sales: { where: { branchId: q.branchId, status: { in: completedStatuses }, createdAt: { gte: from, lte: to } }, select: { total: true } } },
      }),
      this.prisma.category.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      this.prisma.product.count({ where: { organizationId } }),
    ]);
    const number = (value: unknown) => Number(value ?? 0);
    const change = (current: number, previous: number) => previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;
    const salesTotal = number(sales._sum.total), purchaseTotal = number(purchases._sum.total), returnsTotal = number(refunds._sum.total);
    const productStats = new Map<string, { id: string; name: string; price: number; quantity: number; revenue: number; cost: number; imageUrl: string }>();
    const categoryStats = new Map<string, { name: string; salesCount: number }>();
    const monthly = Array.from({ length: 12 }, (_, index) => ({ month: new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(to.getFullYear(), index, 1)), purchase: 0, sales: 0 }));
    const heatmap = Array.from({ length: 9 }, () => Array<number>(7).fill(0));
    for (const sale of saleRows) {
      monthly[sale.createdAt.getMonth()].sales += number(sale.total);
      const day = (sale.createdAt.getDay() + 6) % 7;
      const hour = sale.createdAt.getHours();
      const slot = Math.min(8, Math.floor(hour / 3));
      heatmap[slot][day] += 1;
      for (const item of sale.items) {
        const quantity = number(item.quantity), product = item.product;
        const existing = productStats.get(product.id) ?? { id: product.id, name: product.name, price: number(product.sellingPrice), quantity: 0, revenue: 0, cost: 0, imageUrl: product.images[0]?.url ?? '' };
        existing.quantity += quantity; existing.revenue += number(item.lineTotal); existing.cost += number(product.costPrice) * quantity;
        productStats.set(product.id, existing);
        const categoryName = product.category?.name ?? 'Uncategorized';
        const category = categoryStats.get(product.categoryId ?? 'none') ?? { name: categoryName, salesCount: 0 };
        category.salesCount += quantity; categoryStats.set(product.categoryId ?? 'none', category);
      }
    }
    const purchaseRows = await this.prisma.purchaseOrder.findMany({ where: { branch: { organizationId }, branchId: q.branchId, createdAt: { gte: new Date(to.getFullYear(), 0, 1), lte: to } }, select: { total: true, createdAt: true } });
    for (const order of purchaseRows) monthly[order.createdAt.getMonth()].purchase += number(order.total);
    const grossProfit = [...productStats.values()].reduce((sum, row) => sum + row.revenue - row.cost, 0);
    const totalCategorySales = [...categoryStats.values()].reduce((sum, row) => sum + row.salesCount, 0);
    const imageFallback = '';
    return {
      period: { from, to },
      sales: {
        count: sales._count._all,
        total: Number(sales._sum.total ?? 0),
        paid: Number(sales._sum.paidTotal ?? 0),
        balanceDue: Number(sales._sum.balanceDue ?? 0),
      },
      customers,
      lowStockCount: lowStock.length,
      credit: {
        accounts: credit._count._all,
        outstanding: Number(credit._sum.outstandingBalance ?? 0),
      },
      returns: {
        count: refunds._count._all,
        total: Number(refunds._sum.total ?? 0),
      },
      comparisons: {
        sales: change(salesTotal, number(previousSales._sum.total)),
        purchases: change(purchaseTotal, number(previousPurchases._sum.total)),
        returns: change(returnsTotal, number(previousRefunds._sum.total)),
      },
      purchases: { count: purchases._count._all, total: purchaseTotal },
      profit: grossProfit,
      suppliers,
      customerOverview: {
        firstTime: topCustomers.filter((customer) => customer.createdAt >= from && customer.createdAt <= to).length,
        returning: topCustomers.filter((customer) => customer.sales.length > 1).length,
      },
      monthlyTrends: monthly,
      topSellingProducts: [...productStats.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5).map((row) => ({ ...row, imageUrl: row.imageUrl || imageFallback })),
      lowStockProducts: lowStock.slice(0, 5).map((row) => ({ id: `${row.branch}-${row.sku}`, name: row.product, sku: row.sku, quantity: row.quantity, imageUrl: imageFallback })),
      recentSales: saleRows.slice(0, 5).map((sale) => ({ id: sale.id, invoiceNumber: sale.invoiceNumber, name: sale.items[0]?.product.name ?? sale.invoiceNumber, category: sale.items[0]?.product.category?.name ?? 'Sale', total: number(sale.total), date: sale.createdAt, status: sale.status, imageUrl: sale.items[0]?.product.images[0]?.url ?? imageFallback })),
      topCustomers: topCustomers.map((customer) => ({ id: customer.id, name: `${customer.firstName} ${customer.lastName ?? ''}`.trim(), country: typeof customer.address === 'object' && customer.address && 'country' in customer.address ? String((customer.address as Record<string, unknown>).country ?? '') : '', orderCount: customer.sales.length, spent: customer.sales.reduce((sum, sale) => sum + number(sale.total), 0), avatarUrl: '' })).filter((row) => row.orderCount > 0).sort((a, b) => b.spent - a.spent).slice(0, 5),
      categories: [...categoryStats.values()].sort((a, b) => b.salesCount - a.salesCount).slice(0, 5).map((row) => ({ ...row, percentage: totalCategorySales ? (row.salesCount / totalCategorySales) * 100 : 0 })),
      categorySummary: { totalCategories: categories.length, totalProducts: productCount },
      heatmap,
    };
  }
  async sales(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q),
      { from, to } = this.dates(q);
    const rows = await this.prisma.sale.findMany({
      where: {
        branch: { organizationId },
        branchId: q.branchId,
        createdAt: { gte: from, lte: to },
      },
      include: {
        branch: { select: { code: true, name: true } },
        customer: {
          select: { customerNumber: true, firstName: true, lastName: true },
        },
        payments: { where: { status: PaymentStatus.COMPLETED } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      invoiceNumber: row.invoiceNumber,
      date: row.createdAt,
      branch: row.branch.name,
      customer: row.customer
        ? `${row.customer.firstName} ${row.customer.lastName ?? ''}`.trim()
        : 'Walk-in',
      subtotal: Number(row.subtotal),
      discount: Number(row.discountTotal),
      tax: Number(row.taxTotal),
      total: Number(row.total),
      paid: Number(row.paidTotal),
      balanceDue: Number(row.balanceDue),
      status: row.status,
      paymentMethods: row.payments.map((p) => p.method).join(', '),
    }));
  }
  async inventory(userId: string, branchId?: string) {
    const organizationId = await this.scope(userId, { branchId });
    const rows = await this.prisma.stockLevel.findMany({
      where: { branch: { organizationId }, branchId },
      include: { branch: true, product: true },
      orderBy: { product: { name: 'asc' } },
    });
    return rows.map((row) => ({
      branch: row.branch.name,
      sku: row.product.sku,
      product: row.product.name,
      quantity: Number(row.quantityOnHand),
      reserved: Number(row.quantityReserved),
      available: Number(row.quantityOnHand) - Number(row.quantityReserved),
      costPrice: Number(row.product.costPrice),
      sellingPrice: Number(row.product.sellingPrice),
      costValue: Number(row.quantityOnHand) * Number(row.product.costPrice),
      retailValue:
        Number(row.quantityOnHand) * Number(row.product.sellingPrice),
      reorderLevel: Number(row.product.reorderLevel),
      lowStock: Number(row.quantityOnHand) <= Number(row.product.reorderLevel),
    }));
  }
  async lowStock(userId: string, branchId?: string) {
    return (await this.inventory(userId, branchId)).filter(
      (row) => row.lowStock,
    );
  }
  async creditAging(userId: string) {
    const organizationId = await this.org(userId),
      now = Date.now();
    const rows = await this.prisma.creditAgreement.findMany({
      where: {
        customer: { organizationId },
        status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
      },
      include: {
        customer: {
          select: { customerNumber: true, firstName: true, lastName: true },
        },
        sale: { select: { invoiceNumber: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map((row) => {
      const days = Math.floor(
        (now - row.dueDate.getTime()) / (24 * 60 * 60_000),
      );
      return {
        agreementId: row.id,
        invoiceNumber: row.sale.invoiceNumber,
        customerNumber: row.customer.customerNumber,
        customer:
          `${row.customer.firstName} ${row.customer.lastName ?? ''}`.trim(),
        dueDate: row.dueDate,
        daysOverdue: Math.max(0, days),
        bucket:
          days <= 0
            ? 'CURRENT'
            : days <= 30
              ? '1-30'
              : days <= 60
                ? '31-60'
                : days <= 90
                  ? '61-90'
                  : '90+',
        outstanding: Number(row.outstandingBalance),
        status: row.status,
      };
    });
  }
  async salesCsv(userId: string, q: ReportFilterDto) {
    const rows = await this.sales(userId, q),
      headers = [
        'Invoice',
        'Date',
        'Branch',
        'Customer',
        'Subtotal',
        'Discount',
        'Tax',
        'Total',
        'Paid',
        'Balance Due',
        'Status',
        'Payment Methods',
      ];
    const values = rows.map((row) => [
      row.invoiceNumber,
      row.date.toISOString(),
      row.branch,
      row.customer,
      row.subtotal,
      row.discount,
      row.tax,
      row.total,
      row.paid,
      row.balanceDue,
      row.status,
      row.paymentMethods,
    ]);
    return [headers, ...values]
      .map((row) => row.map((value) => this.csv(value)).join(','))
      .join('\r\n');
  }
  async inventoryCsv(userId: string, branchId?: string) {
    return this.rowsCsv(await this.inventory(userId, branchId));
  }
  async lowStockCsv(userId: string, branchId?: string) {
    return this.rowsCsv(await this.lowStock(userId, branchId));
  }
  async creditAgingCsv(userId: string) {
    return this.rowsCsv(await this.creditAging(userId));
  }
  private rowsCsv(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return '';
    const columns = Object.keys(rows[0]);
    return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
      .map((row) => row.map((value) => this.csv(this.csvValue(value))).join(','))
      .join('\r\n');
  }
  private csvValue(value: unknown): string | number | boolean {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    return value == null ? '' : JSON.stringify(value);
  }
  private csv(value: string | number | boolean | null | undefined) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }
}
