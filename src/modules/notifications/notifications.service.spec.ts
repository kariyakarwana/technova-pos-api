import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '@prisma/client';
import type { PrismaService } from '../../database/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('provides guided customer templates with company variables', () => {
    const service = new NotificationsService(
      {} as PrismaService,
      {} as ConfigService,
    );

    const promotion = service
      .templateCatalog()
      .find((item) => item.eventType === 'PROMOTION_STARTED');

    expect(promotion?.variables).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['companyName']),
        expect.arrayContaining(['customerName']),
      ]),
    );
    expect(promotion?.suggestions.EMAIL.subjectTemplate).toContain(
      '{{companyName}}',
    );
    expect(promotion?.suggestions.WHATSAPP.bodyTemplate).toContain(
      '{{promotionName}}',
    );
  });

  it('requires a subject when creating an email template', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      notificationTemplate: { upsert: jest.fn() },
    };
    const service = new NotificationsService(
      prisma as unknown as PrismaService,
      {} as ConfigService,
    );

    await expect(
      service.createTemplate('user-1', {
        eventType: 'CUSTOMER_WELCOME',
        channel: NotificationChannel.EMAIL,
        name: 'Welcome email',
        bodyTemplate: 'Hello {{customerName}}',
      }),
    ).rejects.toThrow('An email subject is required.');
    expect(prisma.notificationTemplate.upsert).not.toHaveBeenCalled();
  });

  it('queues email and WhatsApp customer welcome messages', async () => {
    type CreateManyInput = { data: Array<Record<string, unknown>> };
    let createManyInput: CreateManyInput | undefined;
    const createMany = jest
      .fn()
      .mockImplementation((input: CreateManyInput) => {
        createManyInput = input;
        return Promise.resolve({ count: 2 });
      });
    const transaction = {
      domainEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationOutbox: {
        createMany,
      },
    };
    const prisma = {
      notificationTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
    };
    const service = new NotificationsService(
      prisma as unknown as PrismaService,
      {} as ConfigService,
    );

    const result = await service.queueCustomerWelcome({
      organizationId: 'org-1',
      companyName: 'Connex Retail',
      customerId: 'customer-1',
      customerNumber: 'CUS-000043',
      firstName: 'Nimal',
      lastName: 'Perera',
      email: 'nimal@example.com',
      phone: '+94771234567',
    });

    expect(result.queuedChannels).toEqual([
      NotificationChannel.EMAIL,
      NotificationChannel.WHATSAPP,
    ]);
    if (!createManyInput)
      throw new Error('Expected welcome notification rows.');
    const rows = createManyInput.data;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: NotificationChannel.EMAIL,
          recipient: 'nimal@example.com',
          subject: 'Welcome to Connex Retail',
        }),
        expect.objectContaining({
          channel: NotificationChannel.WHATSAPP,
          recipient: '+94771234567',
        }),
      ]),
    );
    expect(String(rows[0].body)).toContain('CUS-000043');
    expect(String(rows[1].body)).toContain('Connex Retail');
  });
});
