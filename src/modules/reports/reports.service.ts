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
    const [sales, customers, lowStock, credit, refunds] = await Promise.all([
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
          sale: { branch: { organizationId } },
          createdAt: { gte: from, lte: to },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);
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
  private csv(value: string | number | boolean | null | undefined) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }
}
