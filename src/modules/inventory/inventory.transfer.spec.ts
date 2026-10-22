import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { InventoryService } from './inventory.service';

describe('InventoryService.createTransfer', () => {
  const actor = { id: 'employee-1' } as AuthenticatedUser;
  const context = {} as SecurityRequestContext;
  const dto = {
    sourceBranchId: 'source',
    destinationBranchId: 'destination',
    items: [{ productId: 'product-1', quantity: 3 }],
  };
  const prisma = {
    organizationUser: { findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) },
    branch: { count: jest.fn().mockResolvedValue(2) },
    product: { count: jest.fn().mockResolvedValue(1) },
    stockLevel: { findMany: jest.fn() },
    stockTransfer: { create: jest.fn().mockResolvedValue({ id: 'transfer-1' }) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new InventoryService(prisma as never, audit as never);
  const stock = (onHand: number, reserved: number) => ({
    productId: 'product-1',
    quantityOnHand: new Prisma.Decimal(onHand),
    quantityReserved: new Prisma.Decimal(reserved),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['missing stock', []],
    ['zero stock', [stock(0, 0)]],
    ['insufficient unreserved stock', [stock(5, 3)]],
  ])('rejects %s before creating a transfer', async (_name, levels) => {
    prisma.stockLevel.findMany.mockResolvedValueOnce(levels);

    await expect(service.createTransfer(actor, dto, context)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.stockTransfer.create).not.toHaveBeenCalled();
  });

  it('accepts a quantity within the available balance', async () => {
    prisma.stockLevel.findMany.mockResolvedValueOnce([stock(5, 2)]);

    await expect(service.createTransfer(actor, dto, context)).resolves.toEqual({
      id: 'transfer-1',
    });
    expect(prisma.stockTransfer.create).toHaveBeenCalledTimes(1);
  });

  it('compares fractional stock without floating-point rounding errors', async () => {
    prisma.stockLevel.findMany.mockResolvedValueOnce([stock(0.3, 0.2)]);

    await expect(
      service.createTransfer(
        actor,
        { ...dto, items: [{ productId: 'product-1', quantity: 0.1 }] },
        context,
      ),
    ).resolves.toEqual({ id: 'transfer-1' });
  });
});
