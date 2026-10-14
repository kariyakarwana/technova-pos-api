import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthService } from '../auth/auth.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

jest.mock('../../common/security/password', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('UsersService', () => {
  it('stores the employee phone and queues WhatsApp credentials', async () => {
    let createInput: { data: Record<string, unknown> } | undefined;
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Connex Retail' }),
      },
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'role-1', name: 'CASHIER', permissions: [] },
          ]),
      },
      branch: { count: jest.fn().mockResolvedValue(1) },
      user: {
        create: jest.fn().mockImplementation((input: typeof createInput) => {
          createInput = input;
          return Promise.resolve({
            id: 'employee-1',
            email: 'saman@example.com',
            name: 'Saman Perera',
            phone: '+94771234567',
            status: 'ACTIVE',
          });
        }),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const sentPasswords: string[] = [];
    const auth = {
      sendEmployeeWelcomeEmail: jest.fn(
        (_email: string, _name: string, temporaryPassword: string) => {
          sentPasswords.push(temporaryPassword);
          return Promise.resolve();
        },
      ),
    };
    const notifications = {
      queueEmployeeWelcomeWhatsapp: jest
        .fn()
        .mockResolvedValue({ queued: true }),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      auth as unknown as AuthService,
      notifications as unknown as NotificationsService,
    );

    const result = await service.create(
      {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        roles: ['SUPER_ADMIN'],
        permissions: [],
      } as AuthenticatedUser,
      {
        name: 'Saman Perera',
        email: 'saman@example.com',
        phone: '+94771234567',
        roleIds: ['role-1'],
        branchIds: ['branch-1'],
      },
      {} as SecurityRequestContext,
    );

    expect(createInput?.data).toEqual(
      expect.objectContaining({
        phone: '+94771234567',
        mustChangePassword: true,
      }),
    );
    expect(auth.sendEmployeeWelcomeEmail).toHaveBeenCalledWith(
      'saman@example.com',
      'Saman Perera',
      expect.any(String),
    );
    expect(sentPasswords[0]).toEqual(expect.any(String));
    expect(notifications.queueEmployeeWelcomeWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Connex Retail',
        phone: '+94771234567',
      }),
    );
    expect(result.whatsappQueued).toBe(true);
  });

  it('rejects a non-super-admin assigning the SUPER_ADMIN role', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Store' }),
      },
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'super-role', name: 'SUPER_ADMIN', permissions: [] },
          ]),
      },
      branch: { count: jest.fn().mockResolvedValue(1) },
      userBranch: { count: jest.fn().mockResolvedValue(1) },
      user: { create: jest.fn() },
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      {} as AuthService,
      {} as NotificationsService,
    );

    await expect(
      service.create(
        {
          id: 'manager',
          roles: ['MANAGER'],
          permissions: ['users:manage'],
        } as AuthenticatedUser,
        {
          name: 'Employee',
          email: 'employee@example.com',
          phone: '+94771234567',
          roleIds: ['super-role'],
          branchIds: ['branch-1'],
        },
        {} as SecurityRequestContext,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a non-super-admin assigning SUPER_ADMIN during access updates', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'employee-1' }) },
      userRole: { count: jest.fn().mockResolvedValue(0) },
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'super-role', name: 'SUPER_ADMIN', permissions: [] },
          ]),
      },
      branch: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      {} as AuthService,
      {} as NotificationsService,
    );

    await expect(
      service.updateAccess(
        {
          id: 'manager',
          roles: ['MANAGER'],
          permissions: ['users:manage'],
        } as AuthenticatedUser,
        'employee-1',
        { roleIds: ['super-role'] },
        {} as SecurityRequestContext,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects assigning a branch the manager does not hold', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'employee-1' }) },
      userRole: { count: jest.fn().mockResolvedValue(0) },
      role: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { count: jest.fn().mockResolvedValue(1) },
      userBranch: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      {} as AuthService,
      {} as NotificationsService,
    );

    await expect(
      service.updateAccess(
        {
          id: 'manager',
          roles: ['MANAGER'],
          permissions: ['users:manage'],
        } as AuthenticatedUser,
        'employee-1',
        { branchIds: ['branch-2'] },
        {} as SecurityRequestContext,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-super-admin changing an existing super-admin', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin-2' }) },
      userRole: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      {} as AuthService,
      {} as NotificationsService,
    );

    await expect(
      service.updateAccess(
        {
          id: 'manager',
          roles: ['MANAGER'],
          permissions: ['users:manage'],
        } as AuthenticatedUser,
        'admin-2',
        { name: 'Changed' },
        {} as SecurityRequestContext,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
