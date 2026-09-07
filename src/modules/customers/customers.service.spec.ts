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
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          organization: { name: 'Connex Retail' },
        }),
      },
      customer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ customerNumber: 'CUS-000042' }]),
        create: jest.fn().mockImplementation((input: CustomerCreateInput) => {
          customerCreateInput = input;
          return Promise.resolve({
            id: 'customer-1',
            ...input.data,
            lastName: null,
            loyaltyAccount: { pointsBalance: 0 },
            storeCreditAccount: null,
          });
        }),
      },
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
    expect(notifications.queueCustomerWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Connex Retail',
        customerNumber: 'CUS-000043',
        email: 'nimal@example.com',
        phone: '+94771234567',
      }),
    );
    expect(result.welcomeNotifications).toEqual({
      emailQueued: true,
      whatsappQueued: true,
    });
  });
});
