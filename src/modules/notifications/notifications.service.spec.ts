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
      appNotification: {
        create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
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
      userId: 'user-1',
      customerNumber: 'CUS-000043',
      firstName: 'Nimal',
      lastName: 'Perera',
      email: 'nimal@example.com',
      phone: '+94771234567',
      temporaryPassword: 'TempPass!234',
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
          subject: 'Your Connex Retail customer account',
          // Jest asymmetric matchers are intentionally dynamic.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          body: expect.stringContaining('TempPass!234'),
        }),
        expect.objectContaining({
          channel: NotificationChannel.WHATSAPP,
          recipient: '+94771234567',
          // Jest asymmetric matchers are intentionally dynamic.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          body: expect.stringContaining('TempPass!234'),
        }),
      ]),
    );
    expect(String(rows[0].body)).toContain('CUS-000043');
    expect(String(rows[1].body)).toContain('Connex Retail');
  });

  it('queues an employee WhatsApp welcome without exposing credentials', async () => {
    let outboxInput: { data: Record<string, unknown> } | undefined;
    const transaction = {
      domainEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-employee-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationOutbox: {
        create: jest
          .fn()
          .mockImplementation((input: { data: Record<string, unknown> }) => {
            outboxInput = input;
            return Promise.resolve({ id: 'outbox-1' });
          }),
      },
    };
    const prisma = {
      notificationTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('https://pos.example.com'),
    };
    const service = new NotificationsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    const result = await service.queueEmployeeWelcomeWhatsapp({
      organizationId: 'org-1',
      companyName: 'Connex Retail',
      employeeId: 'employee-1',
      employeeName: 'Saman Perera',
      email: 'saman@example.com',
      phone: '+94771234567',
    });

    expect(result).toEqual({ queued: true });
    expect(outboxInput?.data).toEqual(
      expect.objectContaining({
        channel: NotificationChannel.WHATSAPP,
        recipient: '+94771234567',
        idempotencyKey: 'employee-welcome:employee-1:WHATSAPP',
      }),
    );
    expect(String(outboxInput?.data.body)).toContain('saman@example.com');
    expect(String(outboxInput?.data.body)).not.toContain('Tn1!temporary');
    expect(String(outboxInput?.data.body)).toContain(
      'https://pos.example.com/login',
    );
  });

  it('sends Meta WhatsApp notifications with event parameters', async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: string | undefined;
    const mockFetch = jest.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = typeof init?.body === 'string' ? init.body : undefined;
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue({
            messages: [{ id: 'wamid.test-message' }],
          }),
        } as unknown as Response);
      },
    );
    globalThis.fetch = mockFetch;

    const row = {
      id: 'outbox-1',
      channel: NotificationChannel.WHATSAPP,
      recipient: '+94771234567',
      subject: null,
      body: 'A sale was completed.',
      status: 'PENDING',
      attemptCount: 0,
      domainEvent: {
        eventType: 'SALE_COMPLETED',
        payload: {
          invoiceNumber: 'INV-1001',
          total: '12500.00',
          saleId: 'sale-1',
        },
      },
    };
    const prisma = {
      notificationOutbox: {
        findMany: jest.fn().mockResolvedValue([row]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      deliveryAttempt: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const values: Record<string, string> = {
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_ACCESS_TOKEN: 'test-token',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
      WHATSAPP_GRAPH_API_VERSION: 'v25.0',
      WHATSAPP_TEMPLATE_NAME: 'hello_world',
      WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
      WHATSAPP_TEMPLATE_HAS_BODY_PARAMETER: 'false',
      WHATSAPP_TEMPLATE_NAME_SALE_COMPLETED: 'technova_sale_completed_v1',
      WHATSAPP_TEMPLATE_LANGUAGE_SALE_COMPLETED: 'en_US',
      WHATSAPP_TEMPLATE_HAS_BODY_PARAMETER_SALE_COMPLETED: 'true',
      WHATSAPP_TEMPLATE_PARAMETER_KEYS_SALE_COMPLETED:
        'invoiceNumber,total,saleId',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
      }),
    };
    const service = new NotificationsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    try {
      await service.processPending();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(requestBody ?? '{}')).toEqual({
        messaging_product: 'whatsapp',
        to: '94771234567',
        type: 'template',
        template: {
          name: 'technova_sale_completed_v1',
          language: { code: 'en_US' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'INV-1001' },
                { type: 'text', text: '12500.00' },
                { type: 'text', text: 'sale-1' },
              ],
            },
          ],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
