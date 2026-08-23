import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditStatus,
  InstallmentStatus,
  InventoryUnitStatus,
  PaymentMethod,
  PaymentStatus,
  ReturnStatus,
  SaleStatus,
  StockMovementType,
  WarrantyStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateReturnDto, ReturnQueryDto } from './dto/return.dto';
@Injectable()
export class ReturnsService {
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
  async list(userId: string, q: ReturnQueryDto) {
    const organizationId = await this.org(userId);
    const where = { sale: { branch: { organizationId } }, saleId: q.saleId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          sale: { select: { invoiceNumber: true } },
          items: true,
          refundPayment: true,
        },
      }),
      this.prisma.return.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async detail(userId: string, id: string) {
    const organizationId = await this.org(userId);
    const value = await this.prisma.return.findFirst({
      where: { id, sale: { branch: { organizationId } } },
      include: {
        sale: true,
        items: {
          include: {
            saleItem: { include: { product: true, inventoryUnit: true } },
          },
        },
        refundPayment: true,
      },
    });
    if (!value) throw new NotFoundException('Return not found.');
    return value;
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateReturnDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.org(actor.id);
    const sale = await this.prisma.sale.findFirst({
      where: {
        id: dto.saleId,
        branch: { organizationId },
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
      },
      include: {
        items: {
          include: { product: true, inventoryUnit: true, warranty: true },
        },
        creditAgreement: {
          include: { installments: { orderBy: { installmentNumber: 'desc' } } },
        },
        customer: { include: { loyaltyAccount: true } },
      },
    });
    if (!sale) throw new NotFoundException('Eligible sale not found.');
    const itemMap = new Map(sale.items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const prepared = [] as Array<{
      input: CreateReturnDto['items'][number];
      item: (typeof sale.items)[number];
      refund: number;
    }>;
    for (const input of dto.items) {
      if (seen.has(input.saleItemId))
        throw new BadRequestException(
          'A sale line can appear only once in a return.',
        );
      seen.add(input.saleItemId);
      const item = itemMap.get(input.saleItemId);
      if (!item)
        throw new BadRequestException(
          'Return line does not belong to this sale.',
        );
      const prior = await this.prisma.returnItem.aggregate({
        where: {
          saleItemId: item.id,
          return: { status: ReturnStatus.COMPLETED },
        },
        _sum: { quantity: true },
      });
      const remaining =
        Number(item.quantity) - Number(prior._sum.quantity ?? 0);
      if (input.quantity > remaining + 0.0001)
        throw new ConflictException(
          `Return quantity exceeds the remaining quantity for ${item.product.name}.`,
        );
      if (item.inventoryUnit && input.quantity !== 1)
        throw new BadRequestException(
          'A serialized sale line must be returned as one unit.',
        );
      prepared.push({
        input,
        item,
        refund:
          (Number(item.lineTotal) / Number(item.quantity)) * input.quantity,
      });
    }
    const total = prepared.reduce((s, r) => s + r.refund, 0),
      creditOffset = Math.min(total, Number(sale.balanceDue)),
      cashRefund = total - creditOffset;
    if (cashRefund > 0 && !dto.refundMethod)
      throw new BadRequestException(
        'A refund method is required for the refundable paid amount.',
      );
    if (dto.refundMethod === PaymentMethod.CREDIT)
      throw new BadRequestException('Credit is not a refund payment method.');
    const result = await this.prisma.$transaction(async (tx) => {
      let refundPaymentId: string | undefined;
      if (cashRefund > 0) {
        const payment = await tx.payment.create({
          data: {
            saleId: sale.id,
            method: dto.refundMethod!,
            status: PaymentStatus.REFUNDED,
            amount: cashRefund,
            referenceNumber: dto.refundReference,
            paidAt: new Date(),
          },
        });
        refundPaymentId = payment.id;
      }
      const record = await tx.return.create({
        data: {
          saleId: sale.id,
          refundPaymentId,
          returnNumber: `RET-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
          status: ReturnStatus.COMPLETED,
          reason: dto.reason,
          total,
          completedAt: new Date(),
        },
      });
      for (const row of prepared) {
        await tx.returnItem.create({
          data: {
            returnId: record.id,
            saleItemId: row.item.id,
            quantity: row.input.quantity,
            unitRefund: row.refund / row.input.quantity,
            condition: row.input.condition,
            restock: row.input.restock ?? false,
          },
        });
        if (row.item.inventoryUnitId) {
          await tx.inventoryUnit.update({
            where: { id: row.item.inventoryUnitId },
            data: { status: InventoryUnitStatus.RETURNED },
          });
          await tx.stockMovement.create({
            data: {
              branchId: sale.branchId,
              productId: row.item.productId,
              inventoryUnitId: row.item.inventoryUnitId,
              userId: actor.id,
              type: StockMovementType.RETURN_IN,
              quantity: 1,
              referenceType: 'RETURN',
              referenceId: record.id,
              reason: row.input.condition,
            },
          });
          if (row.item.warranty) {
            await tx.warranty.update({
              where: { id: row.item.warranty.id },
              data: { status: WarrantyStatus.VOIDED, voidedAt: new Date() },
            });
            await tx.warrantyEvent.create({
              data: {
                warrantyId: row.item.warranty.id,
                eventType: 'VOIDED_BY_RETURN',
                notes: dto.reason,
              },
            });
          }
        } else if (row.input.restock) {
          await tx.stockLevel.upsert({
            where: {
              branchId_productId: {
                branchId: sale.branchId,
                productId: row.item.productId,
              },
            },
            create: {
              branchId: sale.branchId,
              productId: row.item.productId,
              quantityOnHand: row.input.quantity,
            },
            update: { quantityOnHand: { increment: row.input.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              branchId: sale.branchId,
              productId: row.item.productId,
              userId: actor.id,
              type: StockMovementType.RETURN_IN,
              quantity: row.input.quantity,
              referenceType: 'RETURN',
              referenceId: record.id,
              reason: row.input.condition,
            },
          });
        }
      }
      if (creditOffset > 0 && sale.creditAgreement) {
        let remainingOffset = creditOffset;
        for (const installment of sale.creditAgreement.installments) {
          if (remainingOffset <= 0) break;
          const reducible = Math.max(
            0,
            Number(installment.amountDue) - Number(installment.amountPaid),
          );
          const reduction = Math.min(remainingOffset, reducible),
            newDue = Number(installment.amountDue) - reduction;
          await tx.creditInstallment.update({
            where: { id: installment.id },
            data: {
              amountDue: newDue,
              status:
                newDue <= Number(installment.amountPaid) + 0.001
                  ? InstallmentStatus.PAID
                  : installment.status,
            },
          });
          remainingOffset -= reduction;
        }
        const outstanding = Math.max(
          0,
          Number(sale.creditAgreement.outstandingBalance) - creditOffset,
        );
        await tx.creditAgreement.update({
          where: { id: sale.creditAgreement.id },
          data: {
            principal: { decrement: creditOffset },
            outstandingBalance: outstanding,
            status:
              outstanding <= 0.01
                ? CreditStatus.PAID
                : sale.creditAgreement.status,
          },
        });
      }
      const returned = await tx.returnItem.aggregate({
        where: { return: { saleId: sale.id, status: ReturnStatus.COMPLETED } },
        _sum: { quantity: true },
      });
      const soldQuantity = sale.items.reduce(
          (s, i) => s + Number(i.quantity),
          0,
        ),
        fullyReturned =
          Number(returned._sum.quantity ?? 0) >= soldQuantity - 0.0001;
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: fullyReturned
            ? SaleStatus.REFUNDED
            : SaleStatus.PARTIALLY_REFUNDED,
          paidTotal: { decrement: cashRefund },
          balanceDue: { decrement: creditOffset },
        },
      });
      if (sale.customer?.loyaltyAccount) {
        const reversal = Math.min(
          sale.customer.loyaltyAccount.points,
          Math.floor(total / 100),
        );
        if (reversal > 0) {
          await tx.loyaltyAccount.update({
            where: { id: sale.customer.loyaltyAccount.id },
            data: { points: { decrement: reversal } },
          });
          await tx.loyaltyTransaction.create({
            data: {
              loyaltyAccountId: sale.customer.loyaltyAccount.id,
              points: -reversal,
              reason: 'RETURN',
              referenceType: 'RETURN',
              referenceId: record.id,
            },
          });
        }
      }
      return {
        returnId: record.id,
        returnNumber: record.returnNumber,
        total,
        creditOffset,
        cashRefund,
        status: fullyReturned
          ? SaleStatus.REFUNDED
          : SaleStatus.PARTIALLY_REFUNDED,
      };
    });
    await this.audit.record({
      userId: actor.id,
      action: 'RETURN_COMPLETED',
      context,
      metadata: { returnId: result.returnId, saleId: sale.id, total },
    });
    return result;
  }
}
