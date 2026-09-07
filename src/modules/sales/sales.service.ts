import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscountType,
  InventoryUnitStatus,
  PaymentStatus,
  PaymentMethod,
  RecordStatus,
  SaleStatus,
  StockMovementType,
  WarrantyStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { generateRawToken, hashToken } from '../../common/security/token';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSaleDto, SaleQueryDto } from './dto/sale.dto';
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async org(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async list(userId: string, q: SaleQueryDto) {
    const organizationId = await this.org(userId);
    const where = {
      branch: { organizationId },
      branchId: q.branchId,
      customerId: q.customerId,
      customer: q.customerPhone
        ? { phone: { contains: q.customerPhone } }
        : undefined,
      createdById: q.cashierId,
      status: q.eligibleForReturn
        ? { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] }
        : (q.status as SaleStatus | undefined),
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
      OR: q.search ? [
        { invoiceNumber: { contains: q.search, mode: 'insensitive' as const } },
        { customer: { firstName: { contains: q.search, mode: 'insensitive' as const } } },
        { customer: { lastName: { contains: q.search, mode: 'insensitive' as const } } },
      ] : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              customerNumber: true,
              firstName: true,
              lastName: true,
            },
          },
          branch: { select: { code: true, name: true } },
          createdBy: { select: { id: true, email: true } },
          _count: { select: { items: true, payments: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async cashiers(userId: string) {
    const organizationId = await this.org(userId);
    return this.prisma.user.findMany({
      where: {
        organizationMemberships: { some: { organizationId } },
        createdSales: { some: { branch: { organizationId } } },
      },
      select: { id: true, email: true },
      orderBy: { email: 'asc' },
    });
  }
  async returnFilterOptions(userId: string, branchId?: string) {
    const organizationId = await this.org(userId);
    return this.prisma.customer.findMany({
      where: {
        organizationId,
        sales: {
          some: {
            branchId,
            status: {
              in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED],
            },
          },
        },
      },
      select: {
        id: true,
        customerNumber: true,
        firstName: true,
        lastName: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }
  async posContext(actor: AuthenticatedUser, branchId: string) {
    if (!branchId) throw new BadRequestException('branchId is required.');
    const organizationId = await this.org(actor.id);
    const canViewAllBranches = actor.permissions.includes('branches:view');
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
        status: RecordStatus.ACTIVE,
        users: canViewAllBranches ? undefined : { some: { userId: actor.id } },
      },
      select: { id: true, code: true, name: true },
    });
    if (!branch) throw new NotFoundException('Active assigned branch not found.');
    const [products, customers] = await Promise.all([
      this.prisma.product.findMany({
        where: { organizationId, status: RecordStatus.ACTIVE },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          sellingPrice: true,
          trackSerials: true,
          category: { select: { name: true } },
          images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
          stockLevels: {
            where: { branchId },
            select: { quantityOnHand: true, quantityReserved: true },
          },
        },
      }),
      this.prisma.customer.findMany({
        where: { organizationId, status: RecordStatus.ACTIVE },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 500,
        select: {
          id: true,
          customerNumber: true,
          firstName: true,
          lastName: true,
          creditLimit: true,
          storeCreditAccount: { select: { balance: true } },
          loyaltyAccount: { select: { points: true } },
          creditAgreements: {
            where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
            select: { outstandingBalance: true },
          },
        },
      }),
    ]);
    return {
      branch,
      products,
      customers: customers.map(({ creditAgreements, ...customer }) => ({
        ...customer,
        currentBalance: creditAgreements.reduce(
          (sum, agreement) => sum + Number(agreement.outstandingBalance),
          0,
        ),
      })),
    };
  }
  async detail(userId: string, id: string) {
    const organizationId = await this.org(userId);
    const value = await this.prisma.sale.findFirst({
      where: { id, branch: { organizationId } },
      include: {
        branch: true,
        customer: true,
        items: {
          include: {
            product: true,
            inventoryUnit: { select: { serialNumber: true } },
            discountApplications: { include: { discountRule: true } },
            warranty: true,
          },
        },
        payments: true,
        receipt: true,
      },
    });
    if (!value) throw new NotFoundException('Sale not found.');
    return value;
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateSaleDto,
    context: SecurityRequestContext,
  ) {
    if (dto.payments.some((payment) => payment.method === PaymentMethod.CREDIT))
      throw new BadRequestException(
        'Use the customer-credit checkout endpoint for credit sales.',
      );
    const organizationId = await this.org(actor.id);
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, organizationId, status: RecordStatus.ACTIVE },
    });
    if (!branch) throw new NotFoundException('Branch not found.');
    const customer = dto.customerId
      ? await this.prisma.customer.findFirst({
          where: {
            id: dto.customerId,
            organizationId,
            status: RecordStatus.ACTIVE,
          },
        })
      : null;
    if (dto.customerId && !customer)
      throw new NotFoundException('Customer not found.');
    const storeCreditPayment = dto.payments
      .filter((payment) => payment.method === PaymentMethod.STORE_CREDIT)
      .reduce((sum, payment) => sum + payment.amount, 0);
    if (storeCreditPayment > 0 && !customer)
      throw new BadRequestException('Store credit requires a registered customer.');
    if (storeCreditPayment > 0) {
      const account = await this.prisma.storeCreditAccount.findUnique({
        where: { customerId: customer!.id },
      });
      if (!account || Number(account.balance) + 0.001 < storeCreditPayment)
        throw new ConflictException('The customer has insufficient store credit.');
    }
    if (dto.credit && !customer)
      throw new BadRequestException('A credit sale requires a customer.');
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        organizationId,
        status: RecordStatus.ACTIVE,
      },
      include: {
        warrantyPolicies: { where: { status: RecordStatus.ACTIVE }, take: 1 },
        discountRules: {
          where: { status: RecordStatus.ACTIVE },
          orderBy: { priority: 'desc' },
        },
      },
    });
    if (products.length !== productIds.length)
      throw new BadRequestException('One or more products are invalid.');
    const productMap = new Map(products.map((p) => [p.id, p]));
    const now = new Date();
    const prepared = dto.items.map((input) => {
      const product = productMap.get(input.productId)!;
      if (product.trackSerials && (!input.serialNumber || input.quantity !== 1))
        throw new BadRequestException(
          `${product.name} requires one serial number per sale line.`,
        );
      if (!product.trackSerials && input.serialNumber)
        throw new BadRequestException(`${product.name} is not serialized.`);
      const gross = Number(product.sellingPrice) * input.quantity;
      const eligible = product.discountRules.filter(
        (r) =>
          Number(r.minimumQuantity) <= input.quantity &&
          (r.maximumQuantity === null ||
            Number(r.maximumQuantity) >= input.quantity) &&
          (!r.startsAt || r.startsAt <= now) &&
          (!r.endsAt || r.endsAt >= now),
      );
      const rule = eligible[0];
      let discount = 0;
      if (rule) {
        if (rule.type === DiscountType.PERCENTAGE)
          discount = (gross * Number(rule.value)) / 100;
        else if (rule.type === DiscountType.FIXED_AMOUNT)
          discount = Number(rule.value);
        else
          discount = Math.max(0, gross - Number(rule.value) * input.quantity);
        discount = Math.min(gross, discount);
      }
      const taxable = gross - discount;
      const tax = (taxable * Number(product.taxRate)) / 100;
      return {
        input,
        product,
        rule,
        unitPrice: Number(product.sellingPrice),
        discount,
        tax,
        total: taxable + tax,
      };
    });
    const subtotal = prepared.reduce(
        (s, i) => s + i.unitPrice * i.input.quantity,
        0,
      ),
      discountTotal = prepared.reduce((s, i) => s + i.discount, 0),
      taxTotal = prepared.reduce((s, i) => s + i.tax, 0),
      total = subtotal - discountTotal + taxTotal;
    const paid = dto.payments.reduce((s, p) => s + p.amount, 0);
    const balanceDue = total - paid;
    if (!dto.credit && Math.abs(balanceDue) > 0.01)
      throw new BadRequestException('Payment total must equal the sale total.');
    if (dto.credit && balanceDue <= 0)
      throw new BadRequestException('A credit sale must have a balance due.');
    if (paid > total + 0.01)
      throw new BadRequestException(
        'Payment total cannot exceed the sale total.',
      );
    if (dto.credit) {
      const dueDate = new Date(dto.credit.dueDate);
      if (dueDate <= now)
        throw new BadRequestException('Credit due date must be in the future.');
      const outstanding = await this.prisma.creditAgreement.aggregate({
        where: {
          customerId: customer!.id,
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
        _sum: { outstandingBalance: true },
      });
      if (
        Number(outstanding._sum.outstandingBalance ?? 0) + balanceDue >
        Number(customer!.creditLimit)
      )
        throw new ConflictException('Customer credit limit would be exceeded.');
      if (dto.credit.installments) {
        const installmentTotal = dto.credit.installments.reduce(
          (sum, item) => sum + item.amount,
          0,
        );
        if (Math.abs(installmentTotal - balanceDue) > 0.01)
          throw new BadRequestException(
            'Installment total must equal the credit balance.',
          );
        if (
          dto.credit.installments.some(
            (item) =>
              new Date(item.dueDate) > dueDate || new Date(item.dueDate) <= now,
          )
        )
          throw new BadRequestException(
            'Installment dates must be future dates no later than the agreement due date.',
          );
      }
    }
    const grants: Array<{ serialNumber: string; activationUrl: string }> = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          branchId: dto.branchId,
          customerId: dto.customerId,
          createdById: actor.id,
          invoiceNumber: `INV-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
          status: SaleStatus.COMPLETED,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          paidTotal: paid,
          balanceDue,
          completedAt: now,
        },
      });
      for (const row of prepared) {
        let unitId: string | undefined;
        if (row.product.trackSerials) {
          const unit = await tx.inventoryUnit.findFirst({
            where: {
              productId: row.product.id,
              branchId: dto.branchId,
              serialNumber: row.input.serialNumber!.trim().toUpperCase(),
              status: InventoryUnitStatus.IN_STOCK,
            },
          });
          if (!unit)
            throw new ConflictException(
              `Serial number for ${row.product.name} is unavailable.`,
            );
          unitId = unit.id;
        }
        const changed = await tx.stockLevel.updateMany({
          where: {
            branchId: dto.branchId,
            productId: row.product.id,
            quantityOnHand: { gte: row.input.quantity },
          },
          data: { quantityOnHand: { decrement: row.input.quantity } },
        });
        if (!changed.count)
          throw new ConflictException(
            `Insufficient stock for ${row.product.name}.`,
          );
        const item = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: row.product.id,
            inventoryUnitId: unitId,
            quantity: row.input.quantity,
            unitPrice: row.unitPrice,
            discountTotal: row.discount,
            taxTotal: row.tax,
            lineTotal: row.total,
          },
        });
        if (row.rule)
          await tx.discountApplication.create({
            data: {
              discountRuleId: row.rule.id,
              saleItemId: item.id,
              amount: row.discount,
            },
          });
        await tx.stockMovement.create({
          data: {
            branchId: dto.branchId,
            productId: row.product.id,
            inventoryUnitId: unitId,
            userId: actor.id,
            type: StockMovementType.SALE,
            quantity: row.input.quantity,
            referenceType: 'SALE',
            referenceId: sale.id,
          },
        });
        if (unitId)
          await tx.inventoryUnit.update({
            where: { id: unitId },
            data: { status: InventoryUnitStatus.SOLD },
          });
        if (unitId && dto.customerId && row.product.warrantyPolicies[0]) {
          const token = generateRawToken(),
            tokenHash = hashToken(token);
          const warranty = await tx.warranty.create({
            data: {
              warrantyPolicyId: row.product.warrantyPolicies[0].id,
              inventoryUnitId: unitId,
              saleItemId: item.id,
              customerId: dto.customerId,
              status: WarrantyStatus.PENDING,
              activationTokenHash: tokenHash,
              activationExpiresAt: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000,
              ),
            },
          });
          await tx.qrAccessGrant.create({
            data: {
              warrantyId: warranty.id,
              tokenHash,
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
          grants.push({
            serialNumber: row.input.serialNumber!,
            activationUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/warranty/activate?token=${token}`,
          });
        }
      }
      await tx.payment.createMany({
        data: dto.payments.map((p) => ({
          saleId: sale.id,
          method: p.method,
          status: PaymentStatus.COMPLETED,
          amount: p.amount,
          referenceNumber: p.referenceNumber,
          paidAt: now,
        })),
      });
      if (storeCreditPayment > 0) {
        const account = await tx.storeCreditAccount.update({
          where: { customerId: dto.customerId! },
          data: { balance: { decrement: storeCreditPayment } },
        });
        await tx.storeCreditTransaction.create({
          data: {
            storeCreditAccountId: account.id,
            amount: -storeCreditPayment,
            reason: 'SALE_REDEMPTION',
            referenceType: 'SALE',
            referenceId: sale.id,
          },
        });
      }
      let creditAgreementId: string | null = null;
      if (dto.credit && dto.customerId) {
        const agreement = await tx.creditAgreement.create({
          data: {
            saleId: sale.id,
            customerId: dto.customerId,
            principal: balanceDue,
            outstandingBalance: balanceDue,
            dueDate: new Date(dto.credit.dueDate),
            notes: dto.credit.notes,
            installments: {
              create: (
                dto.credit.installments ?? [
                  { dueDate: dto.credit.dueDate, amount: balanceDue },
                ]
              ).map((item, index) => ({
                installmentNumber: index + 1,
                amountDue: item.amount,
                dueDate: new Date(item.dueDate),
              })),
            },
          },
        });
        creditAgreementId = agreement.id;
      }
      if (dto.customerId) {
        const points = Math.floor(total / 100);
        if (points > 0) {
          const account = await tx.loyaltyAccount.upsert({
            where: { customerId: dto.customerId },
            create: { customerId: dto.customerId, points },
            update: { points: { increment: points } },
          });
          await tx.loyaltyTransaction.create({
            data: {
              loyaltyAccountId: account.id,
              points,
              reason: 'SALE',
              referenceType: 'SALE',
              referenceId: sale.id,
            },
          });
        }
      }
      const snapshot = {
        invoiceNumber: sale.invoiceNumber,
        completedAt: now.toISOString(),
        branch: { code: branch.code, name: branch.name },
        items: prepared.map((r) => ({
          sku: r.product.sku,
          name: r.product.name,
          quantity: r.input.quantity,
          unitPrice: r.unitPrice,
          discount: r.discount,
          tax: r.tax,
          total: r.total,
          serialNumber: r.input.serialNumber ?? null,
        })),
        subtotal,
        discountTotal,
        taxTotal,
        total,
        balanceDue,
        creditAgreementId,
        payments: dto.payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          referenceNumber: payment.referenceNumber ?? null,
        })),
      };
      const receipt = await tx.receipt.create({
        data: {
          saleId: sale.id,
          receiptNumber: `RCP-${sale.invoiceNumber}`,
          snapshot: snapshot,
        },
      });
      return {
        saleId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        receiptNumber: receipt.receiptNumber,
        total,
        warrantyActivations: grants,
      };
    });
    await this.audit.record({
      userId: actor.id,
      action: 'SALE_COMPLETED',
      context,
      metadata: { saleId: result.saleId, invoiceNumber: result.invoiceNumber },
    });
    return result;
  }

  async quote(userId: string, items: Array<{ productId: string; quantity: number; serialNumber?: string }>) {
    const organizationId = await this.org(userId);
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId, status: RecordStatus.ACTIVE },
      include: { discountRules: { where: { status: RecordStatus.ACTIVE }, orderBy: { priority: 'desc' } } },
    });
    if (products.length !== productIds.length) throw new BadRequestException('One or more products are invalid.');
    const productMap = new Map(products.map((product) => [product.id, product]));
    const now = new Date();
    const lines = items.map((input) => {
      const product = productMap.get(input.productId)!;
      const gross = Number(product.sellingPrice) * input.quantity;
      const rule = product.discountRules.find((candidate) => Number(candidate.minimumQuantity) <= input.quantity && (candidate.maximumQuantity === null || Number(candidate.maximumQuantity) >= input.quantity) && (!candidate.startsAt || candidate.startsAt <= now) && (!candidate.endsAt || candidate.endsAt >= now));
      let discount = 0;
      if (rule?.type === DiscountType.PERCENTAGE) discount = (gross * Number(rule.value)) / 100;
      else if (rule?.type === DiscountType.FIXED_AMOUNT) discount = Number(rule.value);
      else if (rule) discount = Math.max(0, gross - Number(rule.value) * input.quantity);
      discount = Math.min(gross, discount);
      const tax = ((gross - discount) * Number(product.taxRate)) / 100;
      return { productId: product.id, sku: product.sku, name: product.name, quantity: input.quantity, unitPrice: Number(product.sellingPrice), discount, tax, total: gross - discount + tax, discountRule: rule?.name ?? null };
    });
    return { lines, subtotal: lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0), discountTotal: lines.reduce((sum, line) => sum + line.discount, 0), taxTotal: lines.reduce((sum, line) => sum + line.tax, 0), total: lines.reduce((sum, line) => sum + line.total, 0) };
  }
}
