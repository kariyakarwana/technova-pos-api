import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { RolesService } from './roles.service';

const actor = { id: 'admin-1' } as AuthenticatedUser;
const context = {} as SecurityRequestContext;

describe('RolesService permission editing', () => {
  it('allows permissions to be assigned to the built-in CASHIER role', async () => {
    const transaction = {
      role: { update: jest.fn().mockResolvedValue({}) },
      rolePermission: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      role: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'cashier', name: 'CASHIER', isSystem: true }),
      },
      permission: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new RolesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(
      service.update(
        actor,
        'cashier',
        { permissionIds: ['sales-manage-id'] },
        context,
      ),
    ).resolves.toEqual({ updated: true });
    expect(transaction.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'cashier', permissionId: 'sales-manage-id' }],
    });
    expect(transaction.user.updateMany).toHaveBeenCalled();
  });

  it('keeps SUPER_ADMIN permissions immutable', async () => {
    const prisma = {
      role: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'super-admin',
          name: 'SUPER_ADMIN',
          isSystem: true,
        }),
      },
    };
    const service = new RolesService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
    );

    await expect(
      service.update(
        actor,
        'super-admin',
        { permissionIds: ['sales-manage-id'] },
        context,
      ),
    ).rejects.toThrow('SUPER_ADMIN permissions cannot be changed.');
  });
});
