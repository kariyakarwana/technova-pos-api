import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InventoryUnitStatus,
  Prisma,
  PurchaseOrderStatus,
  StockMovementType,
} from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { hashToken } from '../../common/security/token';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreatePurchaseOrderDto,
  PurchaseQueryDto,
  ReceivePurchaseOrderDto,
} from './dto/purchasing.dto';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}
  private async organizationId(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async list(userId: string, q: PurchaseQueryDto) {
    const organizationId = await this.organizationId(userId);
    const where: Prisma.PurchaseOrderWhereInput = {
      branch: { organizationId },
      branchId: q.branchId,
      supplierId: q.supplierId,
      status: q.status as PurchaseOrderStatus | undefined,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
      OR: q.search ? [
        { orderNumber: { contains: q.search, mode: 'insensitive' } },
        { supplier: { name: { contains: q.search, mode: 'insensitive' } } },
      ] : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          branch: { select: { id: true, code: true, name: true } },
          _count: { select: { items: true, receipts: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async detail(userId: string, id: string) {
    const organizationId = await this.organizationId(userId);
    const value = await this.prisma.purchaseOrder.findFirst({
      where: { id, branch: { organizationId } },
      include: {
        supplier: true,
        branch: true,
        items: {
          include: {
            product: {
              select: { id: true, sku: true, name: true, trackSerials: true },
            },
          },
        },
        receipts: {
          include: { items: { include: { inventoryUnits: true } } },
        },
      },
    });
    if (!value) throw new NotFoundException('Purchase order not found.');
    return {
      ...value,
      receipts: value.receipts.map((receipt) => ({
        ...receipt,
        labels: receipt.items.flatMap((item) =>
          item.inventoryUnits.flatMap((unit) => {
            const token = this.qrToken(unit.id, unit.qrVersion);
            return hashToken(token) === unit.qrCodeHash
              ? [{ serialNumber: unit.serialNumber, qrPayload: this.qrPayload(token) }]
              : [];
          }),
        ),
        hasLegacyLabels: receipt.items.some((item) =>
          item.inventoryUnits.some((unit) => {
            const token = this.qrToken(unit.id, unit.qrVersion);
            return hashToken(token) !== unit.qrCodeHash;
          }),
        ),
      })),
    };
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreatePurchaseOrderDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.assertBranchSupplier(
      organizationId,
      dto.branchId,
      dto.supplierId,
    );
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'A product can appear only once per purchase order.',
      );
    if (
      (await this.prisma.product.count({
        where: { id: { in: ids }, organizationId },
      })) !== ids.length
    )
      throw new BadRequestException('One or more products are invalid.');
    let subtotal = 0,
      discountTotal = 0,
      taxTotal = 0;
    const items = dto.items.map((i) => {
      const discount = i.discount ?? 0,
        tax = i.tax ?? 0,
        line = i.quantity * i.unitCost - discount + tax;
      if (line < 0)
        throw new BadRequestException(
          'A purchase line total cannot be negative.',
        );
      subtotal += i.quantity * i.unitCost;
      discountTotal += discount;
      taxTotal += tax;
      return { ...i, discount, tax, lineTotal: line };
    });
    const po = await this.prisma.purchaseOrder.create({
      data: {
        branchId: dto.branchId,
        supplierId: dto.supplierId,
        orderNumber: `PO-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
        notes: dto.notes,
        subtotal,
        discountTotal,
        taxTotal,
        total: subtotal - discountTotal + taxTotal,
        items: { create: items },
      },
      include: { items: true },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'PURCHASE_ORDER_CREATED',
      context,
      metadata: { purchaseOrderId: po.id },
    });
    return po;
  }
  async approve(
    actor: AuthenticatedUser,
    id: string,
    context: SecurityRequestContext,
  ) {
    const po = await this.detail(actor.id, id);
    if (
      po.status !== PurchaseOrderStatus.DRAFT &&
      po.status !== PurchaseOrderStatus.SUBMITTED
    )
      throw new ConflictException(
        'Only draft or submitted orders can be approved.',
      );
    const value = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'PURCHASE_ORDER_APPROVED',
      context,
      metadata: { purchaseOrderId: id },
    });
    return value;
  }
  async receive(
    actor: AuthenticatedUser,
    id: string,
    dto: ReceivePurchaseOrderDto,
    context: SecurityRequestContext,
  ) {
    const po = await this.detail(actor.id, id);
    if (
      po.status !== PurchaseOrderStatus.APPROVED &&
      po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
    )
      throw new ConflictException('Purchase order is not ready to receive.');
    const orderItems = new Map(po.items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const prepared = dto.items.map((input) => {
      if (seen.has(input.purchaseOrderItemId))
        throw new BadRequestException('Receipt item is duplicated.');
      seen.add(input.purchaseOrderItemId);
      const item = orderItems.get(input.purchaseOrderItemId);
      if (!item)
        throw new BadRequestException(
          'Receipt item does not belong to this purchase order.',
        );
      const remaining = Number(item.quantity) - Number(item.receivedQuantity);
      if (input.quantity > remaining)
        throw new BadRequestException(
          `Received quantity exceeds remaining quantity for ${item.product.name}.`,
        );
      if (item.product.trackSerials) {
        if (
          !Number.isInteger(input.quantity) ||
          input.serialNumbers?.length !== input.quantity
        )
          throw new BadRequestException(
            `Every ${item.product.name} unit requires one serial number.`,
          );
      } else if (input.serialNumbers?.length)
        throw new BadRequestException(
          `${item.product.name} is not configured for serial tracking.`,
        );
      return {
        input,
        item,
        qr: (input.serialNumbers ?? []).map((serialNumber) => {
          const unitId = randomUUID();
          const token = this.qrToken(unitId, 1);
          return { unitId, serialNumber, token, tokenHash: hashToken(token) };
        }),
      };
    });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const receipt = await tx.goodsReceipt.create({
          data: {
            branchId: po.branchId,
            purchaseOrderId: po.id,
            receiptNumber: dto.receiptNumber.trim().toUpperCase(),
            supplierInvoiceNumber: dto.supplierInvoiceNumber,
            notes: dto.notes,
          },
        });
        const labels: Array<{ serialNumber: string; qrPayload: string }> = [];
        for (const row of prepared) {
          const ri = await tx.goodsReceiptItem.create({
            data: {
              goodsReceiptId: receipt.id,
              purchaseOrderItemId: row.item.id,
              productId: row.item.productId,
              quantity: row.input.quantity,
              unitCost: row.item.unitCost,
            },
          });
          await tx.purchaseOrderItem.update({
            where: { id: row.item.id },
            data: { receivedQuantity: { increment: row.input.quantity } },
          });
          await tx.stockLevel.upsert({
            where: {
              branchId_productId: {
                branchId: po.branchId,
                productId: row.item.productId,
              },
            },
            create: {
              branchId: po.branchId,
              productId: row.item.productId,
              quantityOnHand: row.input.quantity,
            },
            update: { quantityOnHand: { increment: row.input.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              branchId: po.branchId,
              productId: row.item.productId,
              userId: actor.id,
              type: StockMovementType.PURCHASE_RECEIPT,
              quantity: row.input.quantity,
              referenceType: 'GOODS_RECEIPT',
              referenceId: receipt.id,
            },
          });
          for (const qr of row.qr) {
            await tx.inventoryUnit.create({
              data: {
                id: qr.unitId,
                branchId: po.branchId,
                productId: row.item.productId,
                goodsReceiptItemId: ri.id,
                serialNumber: qr.serialNumber.trim().toUpperCase(),
                status: InventoryUnitStatus.IN_STOCK,
                qrCodeHash: qr.tokenHash,
              },
            });
            labels.push({
              serialNumber: qr.serialNumber,
              qrPayload: this.qrPayload(qr.token),
            });
          }
        }
        const refreshed = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: po.id },
        });
        const complete = refreshed.every(
          (i) => Number(i.receivedQuantity) >= Number(i.quantity),
        );
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: complete
              ? PurchaseOrderStatus.RECEIVED
              : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          },
        });
        return {
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          labels,
        };
      });
      await this.audit.record({
        userId: actor.id,
        action: 'GOODS_RECEIPT_CREATED',
        context,
        metadata: { purchaseOrderId: id, receiptId: result.receiptId },
      });
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Receipt number, serial number, or QR identifier already exists.',
        );
      throw error;
    }
  }
  async reissueReceiptLabels(userId: string, orderId: string, receiptId: string) {
    const organizationId = await this.organizationId(userId);
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id: receiptId, purchaseOrderId: orderId, branch: { organizationId } },
      include: { items: { include: { inventoryUnits: true } } },
    });
    if (!receipt) throw new NotFoundException('Goods receipt not found.');
    const labels: Array<{ serialNumber: string; qrPayload: string }> = [];
    await this.prisma.$transaction(async (tx) => {
      for (const item of receipt.items) {
        for (const unit of item.inventoryUnits) {
          const version = unit.qrVersion + 1;
          const token = this.qrToken(unit.id, version);
          await tx.inventoryUnit.update({ where: { id: unit.id }, data: { qrVersion: version, qrCodeHash: hashToken(token) } });
          labels.push({ serialNumber: unit.serialNumber, qrPayload: this.qrPayload(token) });
        }
      }
    });
    return { receiptId, labels };
  }
  private qrToken(unitId: string, version: number) {
    const value = `${unitId}.${version}`;
    const secret =
      this.config.get<string>('QR_LABEL_SECRET') ??
      this.config.get<string>('AUTH_JWT_ACCESS_SECRET') ??
      this.config.getOrThrow<string>('JWT_ACCESS_PRIVATE_KEY');
    const signature = createHmac('sha256', secret).update(value).digest('base64url');
    return `${value}.${signature}`;
  }
  private qrPayload(token: string) {
    return `${this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'}/qr/product/${token}`;
  }
  private async assertBranchSupplier(
    org: string,
    branchId: string,
    supplierId: string,
  ) {
    const [b, s] = await Promise.all([
      this.prisma.branch.count({
        where: { id: branchId, organizationId: org },
      }),
      this.prisma.supplier.count({
        where: { id: supplierId, organizationId: org },
      }),
    ]);
    if (!b || !s)
      throw new BadRequestException('Branch or supplier is invalid.');
  }
}
