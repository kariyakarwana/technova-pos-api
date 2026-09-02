import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryUnitStatus,
  StockMovementType,
  TransferStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AdjustmentDto,
  CreateTransferDto,
  DispatchTransferDto,
  InventoryQueryDto,
} from './dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async organizationId(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async stock(userId: string, q: InventoryQueryDto) {
    const organizationId = await this.organizationId(userId);
    const where = {
      branch: { organizationId },
      branchId: q.branchId,
      productId: q.productId,
      product: q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockLevel.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        include: {
          branch: { select: { id: true, code: true, name: true } },
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              reorderLevel: true,
              trackSerials: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.stockLevel.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async movements(userId: string, q: InventoryQueryDto) {
    const organizationId = await this.organizationId(userId);
    const where = {
      branch: { organizationId },
      branchId: q.branchId,
      productId: q.productId,
      product: q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        include: {
          product: { select: { sku: true, name: true } },
          branch: { select: { code: true, name: true } },
          inventoryUnit: { select: { serialNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async adjust(
    actor: AuthenticatedUser,
    dto: AdjustmentDto,
    context: SecurityRequestContext,
  ) {
    if (dto.quantityDelta === 0)
      throw new BadRequestException('Adjustment quantity cannot be zero.');
    const org = await this.organizationId(actor.id);
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, organizationId: org },
    });
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, organizationId: org },
    });
    if (!product || !branch)
      throw new NotFoundException('Product or branch not found.');
    if (product.trackSerials)
      throw new BadRequestException(
        'Serialized inventory must be adjusted by individual unit status.',
      );
    await this.prisma.$transaction(async (tx) => {
      if (dto.quantityDelta > 0)
        await tx.stockLevel.upsert({
          where: {
            branchId_productId: {
              branchId: dto.branchId,
              productId: dto.productId,
            },
          },
          create: {
            branchId: dto.branchId,
            productId: dto.productId,
            quantityOnHand: dto.quantityDelta,
          },
          update: { quantityOnHand: { increment: dto.quantityDelta } },
        });
      else {
        const changed = await tx.stockLevel.updateMany({
          where: {
            branchId: dto.branchId,
            productId: dto.productId,
            quantityOnHand: { gte: Math.abs(dto.quantityDelta) },
          },
          data: { quantityOnHand: { increment: dto.quantityDelta } },
        });
        if (!changed.count)
          throw new ConflictException(
            'Insufficient stock for this adjustment.',
          );
      }
      await tx.stockMovement.create({
        data: {
          branchId: dto.branchId,
          productId: dto.productId,
          userId: actor.id,
          type:
            dto.quantityDelta > 0
              ? StockMovementType.ADJUSTMENT_IN
              : StockMovementType.ADJUSTMENT_OUT,
          quantity: Math.abs(dto.quantityDelta),
          reason: dto.reason,
        },
      });
    });
    await this.audit.record({
      userId: actor.id,
      action: 'INVENTORY_ADJUSTED',
      context,
      metadata: {
        branchId: dto.branchId,
        productId: dto.productId,
        quantityDelta: dto.quantityDelta,
      },
    });
    return { adjusted: true };
  }
  async createTransfer(
    actor: AuthenticatedUser,
    dto: CreateTransferDto,
    context: SecurityRequestContext,
  ) {
    if (dto.sourceBranchId === dto.destinationBranchId)
      throw new BadRequestException(
        'Source and destination branches must differ.',
      );
    const org = await this.organizationId(actor.id);
    const branchCount = await this.prisma.branch.count({
      where: {
        id: { in: [dto.sourceBranchId, dto.destinationBranchId] },
        organizationId: org,
      },
    });
    if (branchCount !== 2)
      throw new NotFoundException('Source or destination branch not found.');
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'A product can appear only once in a transfer.',
      );
    if (
      (await this.prisma.product.count({
        where: { id: { in: ids }, organizationId: org },
      })) !== ids.length
    )
      throw new BadRequestException('One or more products are invalid.');
    const transfer = await this.prisma.stockTransfer.create({
      data: {
        transferNumber: `TR-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
        sourceBranchId: dto.sourceBranchId,
        destinationBranchId: dto.destinationBranchId,
        notes: dto.notes,
        status: TransferStatus.SUBMITTED,
        items: { create: dto.items },
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'STOCK_TRANSFER_CREATED',
      context,
      metadata: { transferId: transfer.id },
    });
    return transfer;
  }
  async transfers(userId: string, q: InventoryQueryDto) {
    const organizationId = await this.organizationId(userId);
    const where = {
      sourceBranch: { organizationId },
      OR: q.branchId
        ? [{ sourceBranchId: q.branchId }, { destinationBranchId: q.branchId }]
        : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({ where, skip: q.skip, take: q.pageSize, include: { sourceBranch: true, destinationBranch: true, _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async units(userId: string, q: InventoryQueryDto) {
    const organizationId = await this.organizationId(userId);
    const where = { branch: { organizationId }, branchId: q.branchId, productId: q.productId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.inventoryUnit.findMany({ where, skip: q.skip, take: q.pageSize, include: { branch: { select: { id: true, code: true, name: true } }, product: { select: { id: true, sku: true, name: true } }, warranty: { select: { id: true, status: true, activatedAt: true, endsAt: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.inventoryUnit.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async unit(userId: string, id: string) {
    const organizationId = await this.organizationId(userId);
    const unit = await this.prisma.inventoryUnit.findFirst({ where: { id, branch: { organizationId } }, include: { branch: true, product: true, goodsReceiptItem: { include: { goodsReceipt: true } }, saleItem: { include: { sale: true } }, warranty: { include: { warrantyPolicy: true, events: true } }, movements: { orderBy: { createdAt: 'desc' } } } });
    if (!unit) throw new NotFoundException('Serialized inventory unit not found.');
    return unit;
  }
  async dispatch(
    actor: AuthenticatedUser,
    id: string,
    dto: DispatchTransferDto,
    context: SecurityRequestContext,
  ) {
    const transfer = await this.transfer(actor.id, id);
    if (transfer.status !== TransferStatus.SUBMITTED)
      throw new ConflictException(
        'Only submitted transfers can be dispatched.',
      );
    const serialMap = new Map(
      (dto.serializedItems ?? []).map((i) => [
        i.productId,
        i.serialNumbers.map((s) => s.trim().toUpperCase()),
      ]),
    );
    await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        const quantity = Number(item.quantity);
        const serials = serialMap.get(item.productId) ?? [];
        if (
          item.product.trackSerials &&
          (!Number.isInteger(quantity) || serials.length !== quantity)
        )
          throw new BadRequestException(
            `Every ${item.product.name} unit requires one serial number.`,
          );
        if (!item.product.trackSerials && serials.length)
          throw new BadRequestException(
            `${item.product.name} is not serialized.`,
          );
        const changed = await tx.stockLevel.updateMany({
          where: {
            branchId: transfer.sourceBranchId,
            productId: item.productId,
            quantityOnHand: { gte: quantity },
          },
          data: { quantityOnHand: { decrement: quantity } },
        });
        if (!changed.count)
          throw new ConflictException(
            `Insufficient stock for ${item.product.name}.`,
          );
        if (serials.length) {
          const units = await tx.inventoryUnit.findMany({
            where: {
              branchId: transfer.sourceBranchId,
              productId: item.productId,
              serialNumber: { in: serials },
              status: InventoryUnitStatus.IN_STOCK,
            },
          });
          if (units.length !== serials.length)
            throw new ConflictException(
              `One or more ${item.product.name} serial numbers are unavailable.`,
            );
          for (const unit of units) {
            await tx.inventoryUnit.update({
              where: { id: unit.id },
              data: { status: InventoryUnitStatus.RESERVED },
            });
            await tx.stockMovement.create({
              data: {
                branchId: transfer.sourceBranchId,
                productId: item.productId,
                inventoryUnitId: unit.id,
                userId: actor.id,
                type: StockMovementType.TRANSFER_OUT,
                quantity: 1,
                referenceType: 'STOCK_TRANSFER',
                referenceId: id,
              },
            });
          }
        } else
          await tx.stockMovement.create({
            data: {
              branchId: transfer.sourceBranchId,
              productId: item.productId,
              userId: actor.id,
              type: StockMovementType.TRANSFER_OUT,
              quantity,
              referenceType: 'STOCK_TRANSFER',
              referenceId: id,
            },
          });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.IN_TRANSIT, dispatchedAt: new Date() },
      });
    });
    await this.audit.record({
      userId: actor.id,
      action: 'STOCK_TRANSFER_DISPATCHED',
      context,
      metadata: { transferId: id },
    });
    return { dispatched: true };
  }
  async receive(
    actor: AuthenticatedUser,
    id: string,
    context: SecurityRequestContext,
  ) {
    const transfer = await this.transfer(actor.id, id);
    if (transfer.status !== TransferStatus.IN_TRANSIT)
      throw new ConflictException('Only in-transit transfers can be received.');
    await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        const quantity = Number(item.quantity);
        await tx.stockLevel.upsert({
          where: {
            branchId_productId: {
              branchId: transfer.destinationBranchId,
              productId: item.productId,
            },
          },
          create: {
            branchId: transfer.destinationBranchId,
            productId: item.productId,
            quantityOnHand: quantity,
          },
          update: { quantityOnHand: { increment: quantity } },
        });
        const outgoing = await tx.stockMovement.findMany({
          where: {
            referenceType: 'STOCK_TRANSFER',
            referenceId: id,
            productId: item.productId,
            type: StockMovementType.TRANSFER_OUT,
            inventoryUnitId: { not: null },
          },
        });
        if (outgoing.length) {
          for (const movement of outgoing) {
            await tx.inventoryUnit.update({
              where: { id: movement.inventoryUnitId! },
              data: {
                branchId: transfer.destinationBranchId,
                status: InventoryUnitStatus.IN_STOCK,
              },
            });
            await tx.stockMovement.create({
              data: {
                branchId: transfer.destinationBranchId,
                productId: item.productId,
                inventoryUnitId: movement.inventoryUnitId,
                userId: actor.id,
                type: StockMovementType.TRANSFER_IN,
                quantity: 1,
                referenceType: 'STOCK_TRANSFER',
                referenceId: id,
              },
            });
          }
        } else
          await tx.stockMovement.create({
            data: {
              branchId: transfer.destinationBranchId,
              productId: item.productId,
              userId: actor.id,
              type: StockMovementType.TRANSFER_IN,
              quantity,
              referenceType: 'STOCK_TRANSFER',
              referenceId: id,
            },
          });
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { receivedQuantity: item.quantity },
        });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.RECEIVED, receivedAt: new Date() },
      });
    });
    await this.audit.record({
      userId: actor.id,
      action: 'STOCK_TRANSFER_RECEIVED',
      context,
      metadata: { transferId: id },
    });
    return { received: true };
  }
  async transfer(userId: string, id: string) {
    const org = await this.organizationId(userId);
    const value = await this.prisma.stockTransfer.findFirst({
      where: { id, sourceBranch: { organizationId: org } },
      include: {
        sourceBranch: true,
        destinationBranch: true,
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, trackSerials: true },
            },
          },
        },
      },
    });
    if (!value) throw new NotFoundException('Stock transfer not found.');
    return value;
  }
}
