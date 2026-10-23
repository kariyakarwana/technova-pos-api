import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { SupplierPortalService } from '../suppliers/supplier-portal.service';
import { PurchaseOrderItemDto } from './dto/purchasing.dto';
import { PurchasingService } from './purchasing.service';

describe('PurchasingService purchase order quantities', () => {
  const actor = { id: 'employee-1' } as AuthenticatedUser;
  const context = {} as SecurityRequestContext;

  it('validates API quantities as positive integers', () => {
    const item = (quantity: number) =>
      plainToInstance(PurchaseOrderItemDto, {
        productId: 'product-1', quantity, unitCost: 10,
      });
    expect(validateSync(item(1.017))).not.toHaveLength(0);
    expect(validateSync(item(0))).not.toHaveLength(0);
    expect(validateSync(item(2))).toHaveLength(0);
  });

  function setup(trackSerials: boolean) {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      branch: { count: jest.fn().mockResolvedValue(1) },
      supplier: { count: jest.fn().mockResolvedValue(1) },
      product: {
        findMany: jest.fn().mockResolvedValue([{ id: 'product-1', trackSerials }]),
      },
      purchaseOrder: {
        create: jest.fn().mockResolvedValue({ id: 'order-1' }),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new PurchasingService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as ConfigService,
      {} as SupplierPortalService,
    );
    const dto = {
      branchId: 'branch-1',
      supplierId: 'supplier-1',
      items: [{ productId: 'product-1', quantity: 1.5, unitCost: 10 }],
    };
    return { service, prisma, dto };
  }

  it.each([true, false])('rejects fractional quantities when trackSerials is %s', async (trackSerials) => {
    const { service, prisma, dto } = setup(trackSerials);
    await expect(service.create(actor, dto, context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('creates an order with a whole quantity for nonserialized products', async () => {
    const { service, prisma, dto } = setup(false);
    dto.items[0].quantity = 2;
    await service.create(actor, dto, context);
    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { create: [expect.objectContaining({ quantity: 2 })] },
        }),
      }),
    );
  });
});
