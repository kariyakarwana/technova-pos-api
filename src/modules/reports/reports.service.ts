import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreditStatus, PaymentStatus, PurchaseOrderStatus, RecordStatus, ReturnResolution, ReturnStatus, SaleStatus, StockMovementType, TransferStatus, UserStatus, WarrantyStatus } from '@prisma/client';
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
    if (q.minAmount !== undefined && q.maxAmount !== undefined && q.minAmount > q.maxAmount)
      throw new BadRequestException('Minimum amount cannot be greater than maximum amount.');
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
        createdById: q.cashierId,
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
      this.lowStock(userId, q),
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
    const country = (address: unknown): string => {
      if (!address || typeof address !== 'object' || !('country' in address))
        return '';
      const value = (address as Record<string, unknown>).country;
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '';
    };
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
      topCustomers: topCustomers.map((customer) => ({ id: customer.id, name: `${customer.firstName} ${customer.lastName ?? ''}`.trim(), country: country(customer.address), orderCount: customer.sales.length, spent: customer.sales.reduce((sum, sale) => sum + number(sale.total), 0), avatarUrl: '' })).filter((row) => row.orderCount > 0).sort((a, b) => b.spent - a.spent).slice(0, 5),
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
        customerId: q.customerId,
        createdById: q.cashierId,
        status: q.status as SaleStatus | undefined,
        total: q.minAmount !== undefined || q.maxAmount !== undefined ? { gte: q.minAmount, lte: q.maxAmount } : undefined,
        createdAt: { gte: from, lte: to },
        OR: q.search ? [
          { invoiceNumber: { contains: q.search, mode: 'insensitive' } },
          { customer: { firstName: { contains: q.search, mode: 'insensitive' } } },
          { customer: { lastName: { contains: q.search, mode: 'insensitive' } } },
        ] : undefined,
      },
      include: {
        branch: { select: { code: true, name: true } },
        customer: {
          select: { customerNumber: true, firstName: true, lastName: true },
        },
        payments: { where: { status: PaymentStatus.COMPLETED } },
        createdBy: { select: { id: true, email: true } },
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
      cashier: row.createdBy.email,
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
  async inventory(userId: string, q: ReportFilterDto = {}) {
    const organizationId = await this.scope(userId, q);
    const rows = await this.prisma.stockLevel.findMany({
      where: {
        branch: { organizationId }, branchId: q.branchId, productId: q.productId,
        OR: q.search ? [
          { product: { name: { contains: q.search, mode: 'insensitive' } } },
          { product: { sku: { contains: q.search, mode: 'insensitive' } } },
          { product: { category: { name: { contains: q.search, mode: 'insensitive' } } } },
        ] : undefined,
      },
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
  async lowStock(userId: string, q: ReportFilterDto = {}) {
    return (await this.inventory(userId, q)).filter(
      (row) => row.lowStock,
    );
  }
  async creditAging(userId: string, q: ReportFilterDto = {}) {
    const organizationId = await this.scope(userId, q),
      now = Date.now();
    const rows = await this.prisma.creditAgreement.findMany({
      where: {
        customer: { organizationId },
        sale: { branchId: q.branchId },
        customerId: q.customerId,
        status: q.status
          ? (q.status as CreditStatus)
          : { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
        outstandingBalance:
          q.minAmount !== undefined || q.maxAmount !== undefined
            ? { gte: q.minAmount, lte: q.maxAmount }
            : undefined,
        OR: q.search
          ? [
              { sale: { invoiceNumber: { contains: q.search, mode: 'insensitive' } } },
              { customer: { firstName: { contains: q.search, mode: 'insensitive' } } },
              { customer: { lastName: { contains: q.search, mode: 'insensitive' } } },
              { customer: { customerNumber: { contains: q.search, mode: 'insensitive' } } },
            ]
          : undefined,
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
  async purchases(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q), { from, to } = this.dates(q);
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        branch: { organizationId }, branchId: q.branchId, supplierId: q.supplierId,
        status: q.status as PurchaseOrderStatus | undefined,
        total: q.minAmount !== undefined || q.maxAmount !== undefined ? { gte: q.minAmount, lte: q.maxAmount } : undefined,
        createdAt: { gte: from, lte: to },
        OR: q.search ? [
          { orderNumber: { contains: q.search, mode: 'insensitive' } },
          { supplier: { name: { contains: q.search, mode: 'insensitive' } } },
        ] : undefined,
      },
      include: { branch: true, supplier: true, approvedBy: true, _count: { select: { items: true, receipts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      orderNumber: row.orderNumber, createdAt: row.createdAt, expectedAt: row.expectedAt,
      branch: row.branch.name, supplier: row.supplier.name, items: row._count.items,
      receipts: row._count.receipts, subtotal: Number(row.subtotal), discount: Number(row.discountTotal),
      tax: Number(row.taxTotal), total: Number(row.total), status: row.status,
      approvedBy: row.approvedBy?.email ?? '', approvedAt: row.approvedAt,
    }));
  }
  async returns(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q), { from, to } = this.dates(q);
    const rows = await this.prisma.return.findMany({
      where: {
        sale: { branch: { organizationId }, branchId: q.branchId, customerId: q.customerId },
        status: q.status as ReturnStatus | undefined,
        resolution: q.resolution as ReturnResolution | undefined,
        total: q.minAmount !== undefined || q.maxAmount !== undefined ? { gte: q.minAmount, lte: q.maxAmount } : undefined,
        createdAt: { gte: from, lte: to },
        OR: q.search ? [
          { returnNumber: { contains: q.search, mode: 'insensitive' } },
          { reason: { contains: q.search, mode: 'insensitive' } },
          { sale: { invoiceNumber: { contains: q.search, mode: 'insensitive' } } },
        ] : undefined,
      },
      include: { sale: { include: { branch: true, customer: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      returnNumber: row.returnNumber, invoiceNumber: row.sale.invoiceNumber, createdAt: row.createdAt,
      completedAt: row.completedAt, branch: row.sale.branch.name,
      customer: row.sale.customer ? `${row.sale.customer.firstName} ${row.sale.customer.lastName ?? ''}`.trim() : 'Walk-in',
      items: row._count.items, reason: row.reason, resolution: row.resolution,
      refundAmount: Number(row.total), storeCredit: Number(row.storeCreditAmount),
      loyaltyPoints: row.loyaltyPointsAwarded, status: row.status,
    }));
  }
  async customers(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q), { from, to } = this.dates(q);
    const rows = await this.prisma.customer.findMany({
      where: {
        organizationId, status: q.status as RecordStatus | undefined,
        createdAt: { gte: from, lte: to },
        sales: q.branchId ? { some: { branchId: q.branchId } } : undefined,
        OR: q.search ? [
          { customerNumber: { contains: q.search, mode: 'insensitive' } },
          { firstName: { contains: q.search, mode: 'insensitive' } },
          { lastName: { contains: q.search, mode: 'insensitive' } },
          { email: { contains: q.search, mode: 'insensitive' } },
          { phone: { contains: q.search } },
        ] : undefined,
      },
      include: {
        sales: { where: { branchId: q.branchId, createdAt: { gte: from, lte: to } }, select: { total: true } },
        creditAgreements: { where: { status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] } }, select: { outstandingBalance: true } },
        loyaltyAccount: { select: { points: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      customerNumber: row.customerNumber, customer: `${row.firstName} ${row.lastName ?? ''}`.trim(),
      email: row.email ?? '', phone: row.phone ?? '', status: row.status, joinedAt: row.createdAt,
      orders: row.sales.length, salesTotal: row.sales.reduce((sum, sale) => sum + Number(sale.total), 0),
      creditLimit: Number(row.creditLimit),
      outstandingCredit: row.creditAgreements.reduce((sum, agreement) => sum + Number(agreement.outstandingBalance), 0),
      loyaltyPoints: row.loyaltyAccount?.points ?? 0,
    }));
  }
  async stockMovements(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q), { from, to } = this.dates(q);
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        branch: { organizationId }, branchId: q.branchId, productId: q.productId,
        type: q.status as StockMovementType | undefined, createdAt: { gte: from, lte: to },
        OR: q.search ? [
          { product: { name: { contains: q.search, mode: 'insensitive' } } },
          { product: { sku: { contains: q.search, mode: 'insensitive' } } },
          { reason: { contains: q.search, mode: 'insensitive' } },
          { referenceId: { contains: q.search, mode: 'insensitive' } },
        ] : undefined,
      },
      include: { branch: true, product: true, inventoryUnit: true, user: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      date: row.createdAt, branch: row.branch.name, sku: row.product.sku, product: row.product.name,
      serialNumber: row.inventoryUnit?.serialNumber ?? '', type: row.type, quantity: Number(row.quantity),
      referenceType: row.referenceType ?? '', reference: row.referenceId ?? '',
      reason: row.reason ?? '', performedBy: row.user?.email ?? 'System',
    }));
  }
  async stockTransfers(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q), { from, to } = this.dates(q);
    const rows = await this.prisma.stockTransfer.findMany({
      where: {
        sourceBranch: { organizationId }, status: q.status as TransferStatus | undefined,
        createdAt: { gte: from, lte: to },
        AND: q.branchId ? [{ OR: [{ sourceBranchId: q.branchId }, { destinationBranchId: q.branchId }] }] : undefined,
        OR: q.search ? [
          { transferNumber: { contains: q.search, mode: 'insensitive' } },
          { notes: { contains: q.search, mode: 'insensitive' } },
        ] : undefined,
      },
      include: { sourceBranch: true, destinationBranch: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      transferNumber: row.transferNumber, createdAt: row.createdAt, source: row.sourceBranch.name,
      destination: row.destinationBranch.name, products: row.items.length,
      quantity: row.items.reduce((sum, item) => sum + Number(item.quantity), 0),
      receivedQuantity: row.items.reduce((sum, item) => sum + Number(item.receivedQuantity), 0),
      status: row.status, dispatchedAt: row.dispatchedAt, receivedAt: row.receivedAt, reason: row.notes ?? '',
    }));
  }
  async warranties(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q), { from, to } = this.dates(q);
    const rows = await this.prisma.warranty.findMany({
      where: {
        customer: { organizationId }, customerId: q.customerId,
        inventoryUnit: { productId: q.productId, branchId: q.branchId },
        status: q.status as WarrantyStatus | undefined, createdAt: { gte: from, lte: to },
        OR: q.search ? [
          { inventoryUnit: { serialNumber: { contains: q.search, mode: 'insensitive' } } },
          { customer: { firstName: { contains: q.search, mode: 'insensitive' } } },
          { customer: { lastName: { contains: q.search, mode: 'insensitive' } } },
        ] : undefined,
      },
      include: { customer: true, inventoryUnit: { include: { product: true, branch: true } }, warrantyPolicy: true, _count: { select: { events: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      serialNumber: row.inventoryUnit.serialNumber, product: row.inventoryUnit.product.name,
      branch: row.inventoryUnit.branch.name, customer: `${row.customer.firstName} ${row.customer.lastName ?? ''}`.trim(),
      policy: row.warrantyPolicy.name, status: row.status, startsAt: row.startsAt,
      endsAt: row.endsAt, activatedAt: row.activatedAt, events: row._count.events,
    }));
  }
  async employees(userId: string, q: ReportFilterDto) {
    const organizationId = await this.scope(userId, q), { from, to } = this.dates(q);
    const rows = await this.prisma.user.findMany({
      where: {
        organizationMemberships: { some: { organizationId } },
        status: q.status as UserStatus | undefined, createdAt: { gte: from, lte: to },
        roles: q.roleId ? { some: { roleId: q.roleId } } : undefined,
        branchAssignments: q.branchId ? { some: { branchId: q.branchId } } : undefined,
        OR: q.search ? [
          { name: { contains: q.search, mode: 'insensitive' } },
          { email: { contains: q.search, mode: 'insensitive' } },
        ] : undefined,
      },
      include: { roles: { include: { role: true } }, branchAssignments: { include: { branch: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      employee: row.name ?? '', email: row.email, roles: row.roles.map(({ role }) => role.name).join(', '),
      branches: row.branchAssignments.map(({ branch }) => branch.name).join(', '),
      status: row.status, emailVerified: Boolean(row.emailVerified), lastLoginAt: row.lastLoginAt, createdAt: row.createdAt,
    }));
  }
  async salesCsv(userId: string, q: ReportFilterDto) {
    const rows = await this.sales(userId, q),
      headers = [
        'Invoice',
        'Date',
        'Branch',
        'Customer',
        'Cashier',
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
      row.cashier,
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
  async inventoryCsv(userId: string, q: ReportFilterDto) {
    return this.rowsCsv(await this.inventory(userId, q));
  }
  async lowStockCsv(userId: string, q: ReportFilterDto) {
    return this.rowsCsv(await this.lowStock(userId, q));
  }
  async creditAgingCsv(userId: string, q: ReportFilterDto) {
    return this.rowsCsv(await this.creditAging(userId, q));
  }
  async purchasesCsv(userId: string, q: ReportFilterDto) { return this.rowsCsv(await this.purchases(userId, q)); }
  async returnsCsv(userId: string, q: ReportFilterDto) { return this.rowsCsv(await this.returns(userId, q)); }
  async customersCsv(userId: string, q: ReportFilterDto) { return this.rowsCsv(await this.customers(userId, q)); }
  async stockMovementsCsv(userId: string, q: ReportFilterDto) { return this.rowsCsv(await this.stockMovements(userId, q)); }
  async stockTransfersCsv(userId: string, q: ReportFilterDto) { return this.rowsCsv(await this.stockTransfers(userId, q)); }
  async warrantiesCsv(userId: string, q: ReportFilterDto) { return this.rowsCsv(await this.warranties(userId, q)); }
  async employeesCsv(userId: string, q: ReportFilterDto) { return this.rowsCsv(await this.employees(userId, q)); }
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
