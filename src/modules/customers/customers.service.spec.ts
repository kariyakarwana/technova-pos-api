import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  it('generates the customer number and queues welcome notifications', async () => {
    type CustomerCreateInput = {
      data: Record<string, unknown>;
    };
    let customerCreateInput: CustomerCreateInput | undefined;
    const transaction = {
      permission: {
        upsert: jest.fn().mockResolvedValue({ id: 'permission-1' }),
      },
      role: { upsert: jest.fn().mockResolvedValue({ id: 'role-1' }) },
      rolePermission: { upsert: jest.fn().mockResolvedValue({}) },
      user: { create: jest.fn().mockResolvedValue({ id: 'customer-user-1' }) },
      customer: {
        create: jest.fn().mockImplementation((input: CustomerCreateInput) => {
          customerCreateInput = input;
          return Promise.resolve({
            id: 'customer-1',
            ...input.data,
            lastName: null,
            loyaltyAccount: { points: 0 },
            storeCreditAccount: null,
          });
        }),
      },
    };
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          organization: { name: 'Connex Retail' },
        }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      customer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ customerNumber: 'CUS-000042' }]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const notifications = {
      queueCustomerWelcome: jest.fn().mockResolvedValue({
        queuedChannels: ['EMAIL', 'WHATSAPP'],
      }),
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );

    const result = await service.create(
      { id: 'user-1' } as AuthenticatedUser,
      {
        firstName: 'Nimal',
        email: 'nimal@example.com',
        phone: '+94771234567',
      },
      {} as SecurityRequestContext,
    );

    expect(result.customerNumber).toBe('CUS-000043');
    if (!customerCreateInput)
      throw new Error('Expected a customer create operation.');
    expect(customerCreateInput.data.organizationId).toBe('org-1');
    expect(customerCreateInput.data.customerNumber).toBe('CUS-000043');
    expect(customerCreateInput.data.userId).toBe('customer-user-1');
    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'nimal@example.com',
          phone: '+94771234567',
          mustChangePassword: true,
        }),
      }),
    );
    expect(notifications.queueCustomerWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Connex Retail',
        customerNumber: 'CUS-000043',
        email: 'nimal@example.com',
        phone: '+94771234567',
        userId: 'customer-user-1',
        temporaryPassword: expect.any(String),
      }),
    );
    expect(result.welcomeNotifications).toEqual({
      emailQueued: true,
      whatsappQueued: true,
    });
    expect(result.credentialsCreated).toBe(true);
  });

  it('enables login for an existing unlinked customer without replacing the customer', async () => {
    const customer = {
      id: 'customer-2',
      organizationId: 'org-1',
      userId: null,
      customerNumber: 'CUS-000002',
      firstName: 'Nimal',
      lastName: 'Perera',
      email: 'Nimal@Example.com',
      phone: '+94771234567',
      status: RecordStatus.ACTIVE,
    };
    const transaction = {
      permission: { upsert: jest.fn().mockResolvedValue({ id: 'permission-1' }) },
      role: { upsert: jest.fn().mockResolvedValue({ id: 'role-1' }) },
      rolePermission: { upsert: jest.fn().mockResolvedValue({}) },
      user: { create: jest.fn().mockResolvedValue({ id: 'customer-user-2' }) },
      customer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          organization: { name: 'Connex Retail' },
        }),
      },
      customer: { findFirst: jest.fn().mockResolvedValue(customer) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(
        (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const notifications = {
      queueCustomerWelcome: jest.fn().mockResolvedValue({
        queuedChannels: ['EMAIL', 'WHATSAPP'],
      }),
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );

    const result = await service.enableLogin(
      { id: 'staff-1' } as AuthenticatedUser,
      customer.id,
      {} as SecurityRequestContext,
    );

    expect(transaction.customer.updateMany).toHaveBeenCalledWith({
      where: {
        id: customer.id,
        organizationId: 'org-1',
        userId: null,
        status: RecordStatus.ACTIVE,
      },
      data: { userId: 'customer-user-2' },
    });
    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'nimal@example.com',
          phone: '+94771234567',
          mustChangePassword: true,
        }),
      }),
    );
    expect(notifications.queueCustomerWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: customer.id,
        customerNumber: 'CUS-000002',
        email: 'nimal@example.com',
        userId: 'customer-user-2',
      }),
    );
    expect(result.credentialsCreated).toBe(true);
    expect(result.temporaryPasswordSent).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_LOGIN_ENABLED' }),
    );
  });

  it('refuses to enable login twice for the same customer', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'customer-2',
          userId: 'existing-user',
        }),
      },
      user: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const notifications = { queueCustomerWelcome: jest.fn() };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );

    await expect(
      service.enableLogin(
        { id: 'staff-1' } as AuthenticatedUser,
        'customer-2',
        {} as SecurityRequestContext,
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.queueCustomerWelcome).not.toHaveBeenCalled();
  });
});
import { ConflictException } from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
