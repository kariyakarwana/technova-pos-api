import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannel,
  OutboxStatus,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { paginate } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  CreateTemplateDto,
  OutboxQueryDto,
  AppNotificationQueryDto,
  PreferenceDto,
  UpdateTemplateDto,
} from './dto/notification.dto';

type CustomerWelcomeInput = {
  organizationId: string;
  companyName: string;
  customerId: string;
  customerNumber: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  private async org(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async publishFromAudit(
    userId: string | undefined,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ) {
    if (!userId) return;
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
      include: { organization: true },
    });
    if (!membership) return;
    const event = await this.prisma.domainEvent.create({
      data: {
        organizationId: membership.organizationId,
        aggregateType: eventType.split('_')[0] ?? 'SYSTEM',
        aggregateId: this.aggregateId(payload),
        eventType,
        payload,
      },
    });
    const templatePayload: Prisma.InputJsonObject = {
      ...(payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Prisma.InputJsonObject)
        : { payload }),
      companyName: membership.organization.name,
    };
    const templates = await this.prisma.notificationTemplate.findMany({
      where: {
        organizationId: membership.organizationId,
        eventType,
        status: RecordStatus.ACTIVE,
      },
    });
    for (const template of templates) {
      const recipient =
        template.channel === NotificationChannel.EMAIL
          ? membership.organization.email
          : membership.organization.phone;
      if (!recipient) continue;
      await this.prisma.notificationOutbox.create({
        data: {
          domainEventId: event.id,
          templateId: template.id,
          channel: template.channel,
          recipient,
          subject: template.subjectTemplate
            ? this.render(template.subjectTemplate, eventType, templatePayload)
            : undefined,
          body: this.render(template.bodyTemplate, eventType, templatePayload),
          idempotencyKey: `${event.id}:${template.id}:${recipient}`,
        },
      });
    }
    await this.prisma.domainEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  }

  async queueCustomerWelcome(input: CustomerWelcomeInput) {
    const destinations: Array<{
      channel: NotificationChannel;
      recipient: string;
    }> = [];
    if (input.email)
      destinations.push({
        channel: NotificationChannel.EMAIL,
        recipient: input.email,
      });
    if (input.phone)
      destinations.push({
        channel: NotificationChannel.WHATSAPP,
        recipient: input.phone,
      });
    if (!destinations.length) return { queuedChannels: [] as string[] };

    const eventType = 'CUSTOMER_WELCOME';
    const payload = {
      companyName: input.companyName,
      customerId: input.customerId,
      customerNumber: input.customerNumber,
      customerName: `${input.firstName} ${input.lastName ?? ''}`.trim(),
      firstName: input.firstName,
    };
    const templates = await this.prisma.notificationTemplate.findMany({
      where: {
        organizationId: input.organizationId,
        eventType,
        channel: { in: destinations.map((item) => item.channel) },
      },
    });
    const templateByChannel = new Map(
      templates.map((template) => [template.channel, template]),
    );
    const enabledDestinations = destinations.filter((destination) => {
      const template = templateByChannel.get(destination.channel);
      return !template || template.status === RecordStatus.ACTIVE;
    });
    if (!enabledDestinations.length) return { queuedChannels: [] as string[] };

    await this.prisma.$transaction(async (transaction) => {
      const event = await transaction.domainEvent.create({
        data: {
          organizationId: input.organizationId,
          aggregateType: 'CUSTOMER',
          aggregateId: input.customerId,
          eventType,
          payload,
        },
      });
      await transaction.notificationOutbox.createMany({
        data: enabledDestinations.map((destination) => {
          const template = templateByChannel.get(destination.channel);
          const isEmail = destination.channel === NotificationChannel.EMAIL;
          return {
            domainEventId: event.id,
            templateId: template?.id,
            channel: destination.channel,
            recipient: destination.recipient,
            subject: isEmail
              ? template?.subjectTemplate
                ? this.render(template.subjectTemplate, eventType, payload)
                : `Welcome to ${input.companyName}`
              : undefined,
            body: template
              ? this.render(template.bodyTemplate, eventType, payload)
              : isEmail
                ? `<p>Hello ${this.escapeHtml(payload.customerName)},</p><p>Thank you for being a customer of <strong>${this.escapeHtml(input.companyName)}</strong>.</p><p>Your customer number is <strong>${this.escapeHtml(input.customerNumber)}</strong>. We look forward to serving you.</p>`
                : `Hello ${payload.customerName}! Thank you for being a customer of ${input.companyName}. Your customer number is ${input.customerNumber}. We look forward to serving you.`,
            idempotencyKey: `customer-welcome:${input.customerId}:${destination.channel}`,
          };
        }),
      });
      await transaction.domainEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    });

    return {
      queuedChannels: enabledDestinations.map((item) => item.channel),
    };
  }
  async templates(userId: string) {
    const organizationId = await this.org(userId);
    return this.prisma.notificationTemplate.findMany({
      where: { organizationId },
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
    });
  }
  templateCatalog() {
    return [
      {
        eventType: 'CUSTOMER_WELCOME',
        label: 'Customer welcome',
        audience: 'Customer',
        description: 'Sent after a new customer profile is created.',
        variables: [
          ['companyName', 'Company name', 'TechNova'],
          ['customerName', 'Customer full name', 'Saman Perera'],
          ['firstName', 'Customer first name', 'Saman'],
          ['customerNumber', 'Customer number', 'CUS-000124'],
        ],
        suggestions: {
          EMAIL: {
            name: 'Customer welcome email',
            subjectTemplate: 'Welcome to {{companyName}}',
            bodyTemplate:
              'Hello {{customerName}},\n\nThank you for becoming a customer of {{companyName}}.\nYour customer number is {{customerNumber}}.\n\nWe look forward to serving you.',
          },
          WHATSAPP: {
            name: 'Customer welcome WhatsApp',
            bodyTemplate:
              'Hello {{firstName}}! Thank you for becoming a customer of {{companyName}}. Your customer number is {{customerNumber}}. We look forward to serving you.',
          },
        },
      },
      {
        eventType: 'PROMOTION_STARTED',
        label: 'Promotion started',
        audience: 'Customer',
        description:
          'Sent once when an enabled promotion reaches its start time.',
        variables: [
          ['companyName', 'Company name', 'TechNova'],
          ['customerName', 'Customer full name', 'Saman Perera'],
          ['promotionName', 'Promotion name', 'September Sale'],
          ['promotionCode', 'Promotion code', 'SEP-SALE'],
          ['description', 'Promotion description', 'Selected items only'],
          ['offer', 'Promotion offer', '15% off'],
          ['product', 'Eligible product', 'All eligible products'],
          ['startsAt', 'Start date/time', 'September 7, 2026'],
          ['endsAt', 'End date/time', 'September 30, 2026'],
        ],
        suggestions: {
          EMAIL: {
            name: 'Promotion launch email',
            subjectTemplate:
              '{{promotionName}} is now available at {{companyName}}',
            bodyTemplate:
              'Hello {{customerName}},\n\n{{promotionName}} has started at {{companyName}}.\nOffer: {{offer}} on {{product}}.\nCode: {{promotionCode}}\nValid until: {{endsAt}}\n\n{{description}}',
          },
          WHATSAPP: {
            name: 'Promotion launch WhatsApp',
            bodyTemplate:
              'Hello {{customerName}}! {{promotionName}} is now available at {{companyName}}: {{offer}} on {{product}}. Code: {{promotionCode}}. Valid until {{endsAt}}. {{description}}',
          },
        },
      },
      {
        eventType: 'CREDIT_PAYMENT_REMINDER',
        label: 'Credit payment reminder',
        audience: 'Customer',
        description: 'Sent when a credit installment is due or overdue.',
        variables: [
          ['customerNumber', 'Customer number', 'CUS-000124'],
          ['installmentId', 'Installment reference', 'INS-1045'],
          ['dueDate', 'Payment due date', 'September 10, 2026'],
          ['amountDue', 'Outstanding amount', '12500'],
        ],
        suggestions: {
          EMAIL: {
            name: 'Credit payment reminder email',
            subjectTemplate: 'Payment reminder for {{customerNumber}}',
            bodyTemplate:
              'Hello,\n\nThis is a friendly reminder that LKR {{amountDue}} is due on {{dueDate}} for customer {{customerNumber}}.\nReference: {{installmentId}}.',
          },
          WHATSAPP: {
            name: 'Credit payment reminder WhatsApp',
            bodyTemplate:
              'Payment reminder: LKR {{amountDue}} is due on {{dueDate}} for customer {{customerNumber}}. Reference: {{installmentId}}.',
          },
        },
      },
      {
        eventType: 'LOW_STOCK_ALERT',
        label: 'Low stock alert',
        audience: 'Company contact',
        description:
          'Sent to the company contact when stock reaches the reorder level.',
        variables: [
          ['branch', 'Branch name', 'Colombo Branch'],
          ['sku', 'Product SKU', 'SKU-1004'],
          ['product', 'Product name', 'Wireless Mouse'],
          ['quantity', 'Current quantity', '3'],
          ['reorderLevel', 'Reorder level', '10'],
        ],
        suggestions: {
          EMAIL: {
            name: 'Low stock alert email',
            subjectTemplate: 'Low stock: {{product}} at {{branch}}',
            bodyTemplate:
              '{{product}} ({{sku}}) is low at {{branch}}.\nCurrent stock: {{quantity}}\nReorder level: {{reorderLevel}}',
          },
          WHATSAPP: {
            name: 'Low stock alert WhatsApp',
            bodyTemplate:
              'Low stock alert: {{product}} ({{sku}}) at {{branch}} has {{quantity}} remaining. Reorder level: {{reorderLevel}}.',
          },
        },
      },
      ...[
        ['SALE_COMPLETED', 'Sale completed', 'saleId'],
        ['PURCHASE_ORDER_CREATED', 'Purchase order created', 'purchaseOrderId'],
        [
          'PURCHASE_ORDER_APPROVED',
          'Purchase order approved',
          'purchaseOrderId',
        ],
        ['GOODS_RECEIPT_CREATED', 'Goods receipt created', 'goodsReceiptId'],
        ['INVENTORY_ADJUSTED', 'Inventory adjusted', 'stockAdjustmentId'],
        ['STOCK_TRANSFER_CREATED', 'Stock transfer created', 'transferId'],
        [
          'STOCK_TRANSFER_DISPATCHED',
          'Stock transfer dispatched',
          'transferId',
        ],
        ['STOCK_TRANSFER_RECEIVED', 'Stock transfer received', 'transferId'],
        ['RETURN_COMPLETED', 'Return completed', 'returnId'],
        ['CREDIT_PAYMENT_RECEIVED', 'Credit payment received', 'paymentId'],
      ].map(([eventType, label, referenceKey]) => ({
        eventType,
        label,
        audience: 'Company contact',
        description:
          'An internal operational notification generated by the system.',
        variables: [
          ['companyName', 'Company name', 'TechNova'],
          [referenceKey, 'Record reference', 'SYSTEM-REFERENCE'],
        ],
        suggestions: {
          EMAIL: {
            name: `${label} email`,
            subjectTemplate: `${label} at {{companyName}}`,
            bodyTemplate: `${label} at {{companyName}}.\nReference: {{${referenceKey}}}.`,
          },
          WHATSAPP: {
            name: `${label} WhatsApp`,
            bodyTemplate: `${label} at {{companyName}}. Reference: {{${referenceKey}}}.`,
          },
        },
      })),
    ];
  }
  async createTemplate(userId: string, dto: CreateTemplateDto) {
    const organizationId = await this.org(userId);
    const eventType = dto.eventType.trim().toUpperCase();
    const name = dto.name.trim();
    const bodyTemplate = dto.bodyTemplate.trim();
    const subjectTemplate = dto.subjectTemplate?.trim() || undefined;
    if (dto.channel === NotificationChannel.EMAIL && !subjectTemplate)
      throw new BadRequestException('An email subject is required.');
    if (
      dto.channel === NotificationChannel.WHATSAPP &&
      bodyTemplate.length > 1024
    )
      throw new BadRequestException(
        'WhatsApp templates cannot exceed 1,024 characters.',
      );
    return this.prisma.notificationTemplate.upsert({
      where: {
        organizationId_eventType_channel: {
          organizationId,
          eventType,
          channel: dto.channel,
        },
      },
      create: {
        organizationId,
        eventType,
        channel: dto.channel,
        name,
        subjectTemplate,
        bodyTemplate,
        status: dto.status,
      },
      update: { name, subjectTemplate, bodyTemplate, status: dto.status },
    });
  }
  async updateTemplate(userId: string, id: string, dto: UpdateTemplateDto) {
    const organizationId = await this.org(userId);
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id, organizationId },
    });
    if (!existing)
      throw new NotFoundException('Notification template not found.');
    const subjectTemplate =
      dto.subjectTemplate === undefined
        ? existing.subjectTemplate
        : dto.subjectTemplate.trim() || null;
    if (existing.channel === NotificationChannel.EMAIL && !subjectTemplate)
      throw new BadRequestException('An email subject is required.');
    if (
      existing.channel === NotificationChannel.WHATSAPP &&
      dto.bodyTemplate &&
      dto.bodyTemplate.trim().length > 1024
    )
      throw new BadRequestException(
        'WhatsApp templates cannot exceed 1,024 characters.',
      );
    return this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        subjectTemplate,
        bodyTemplate: dto.bodyTemplate?.trim(),
        status: dto.status,
      },
    });
  }
  async preference(userId: string, dto: PreferenceDto) {
    const organizationId = await this.org(userId);
    if (
      !(await this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId },
      }))
    )
      throw new NotFoundException('Customer not found.');
    return this.prisma.notificationPreference.upsert({
      where: {
        customerId_channel_eventType: {
          customerId: dto.customerId,
          channel: dto.channel,
          eventType: dto.eventType,
        },
      },
      create: dto,
      update: { enabled: dto.enabled },
    });
  }
  async outbox(userId: string, q: OutboxQueryDto) {
    const organizationId = await this.org(userId);
    const where: Prisma.NotificationOutboxWhereInput = {
      domainEvent: { organizationId },
      status: q.status as OutboxStatus | undefined,
      channel: q.channel,
      OR: q.search
        ? [
            { recipient: { contains: q.search, mode: 'insensitive' } },
            { body: { contains: q.search, mode: 'insensitive' } },
            { subject: { contains: q.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [data, total, pending, processing, sent, failed, deadLetter] =
      await this.prisma.$transaction([
        this.prisma.notificationOutbox.findMany({
          where,
          skip: q.skip,
          take: q.pageSize,
          orderBy: { createdAt: 'desc' },
          include: { attempts: { take: 5, orderBy: { attemptedAt: 'desc' } } },
        }),
        this.prisma.notificationOutbox.count({ where }),
        ...[
          OutboxStatus.PENDING,
          OutboxStatus.PROCESSING,
          OutboxStatus.SENT,
          OutboxStatus.FAILED,
          OutboxStatus.DEAD_LETTER,
        ].map((status) =>
          this.prisma.notificationOutbox.count({
            where: { domainEvent: { organizationId }, status },
          }),
        ),
      ]);
    return {
      ...paginate(data, total, q),
      summary: {
        PENDING: pending,
        PROCESSING: processing,
        SENT: sent,
        FAILED: failed,
        DEAD_LETTER: deadLetter,
      },
    };
  }
  async appNotifications(userId: string, q: AppNotificationQueryDto) {
    const where: Prisma.AppNotificationWhereInput = {
      recipientUserId: userId,
      readAt: q.unread === 'true' ? null : undefined,
    };
    const [data, total, unread] = await this.prisma.$transaction([
      this.prisma.appNotification.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.appNotification.count({ where }),
      this.prisma.appNotification.count({
        where: { recipientUserId: userId, readAt: null },
      }),
    ]);
    return { ...paginate(data, total, q), unread };
  }
  async readAppNotification(userId: string, id: string) {
    const result = await this.prisma.appNotification.updateMany({
      where: { id, recipientUserId: userId },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Notification not found.');
    return { read: true };
  }
  async readAllAppNotifications(userId: string) {
    const result = await this.prisma.appNotification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: result.count };
  }
  async processPending(limit = 20) {
    const rows = await this.prisma.notificationOutbox.findMany({
      where: {
        status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
        nextAttemptAt: { lte: new Date() },
        attemptCount: { lt: 5 },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    for (const row of rows) {
      const claimed = await this.prisma.notificationOutbox.updateMany({
        where: {
          id: row.id,
          status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
        },
        data: { status: OutboxStatus.PROCESSING },
      });
      if (!claimed.count) continue;
      try {
        const providerId = await this.deliver(
          row.channel,
          row.recipient,
          row.subject,
          row.body,
        );
        await this.prisma.$transaction([
          this.prisma.deliveryAttempt.create({
            data: {
              notificationOutboxId: row.id,
              successful: true,
              providerMessageId: providerId,
            },
          }),
          this.prisma.notificationOutbox.update({
            where: { id: row.id },
            data: {
              status: OutboxStatus.SENT,
              sentAt: new Date(),
              attemptCount: { increment: 1 },
              lastError: null,
            },
          }),
        ]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Delivery failed';
        const attempts = row.attemptCount + 1;
        await this.prisma.$transaction([
          this.prisma.deliveryAttempt.create({
            data: {
              notificationOutboxId: row.id,
              successful: false,
              errorMessage: message,
            },
          }),
          this.prisma.notificationOutbox.update({
            where: { id: row.id },
            data: {
              status:
                attempts >= 5 ? OutboxStatus.DEAD_LETTER : OutboxStatus.FAILED,
              attemptCount: { increment: 1 },
              lastError: message,
              nextAttemptAt: new Date(
                Date.now() + Math.min(60, 2 ** attempts) * 60_000,
              ),
            },
          }),
        ]);
      }
    }
    return { processed: rows.length };
  }
  providerStatus() {
    const provider = (
      this.config.get<string>('WHATSAPP_PROVIDER') ?? 'meta'
    ).toLowerCase();
    const configured =
      provider === 'whatchimp'
        ? Boolean(
            this.config.get('WHATCHIMP_API_TOKEN') &&
            this.config.get('WHATCHIMP_PHONE_NUMBER_ID') &&
            this.config.get('WHATCHIMP_TEMPLATE_NAME'),
          )
        : Boolean(
            this.config.get('WHATSAPP_ACCESS_TOKEN') &&
            this.config.get('WHATSAPP_PHONE_NUMBER_ID'),
          );
    return {
      provider,
      configured,
      emailConfigured: Boolean(
        this.config.get('SMTP_HOST') &&
        this.config.get('SMTP_USER') &&
        this.config.get('SMTP_PASSWORD') &&
        this.config.get('SMTP_FROM'),
      ),
      workerEnabled:
        this.config.get<string>('NOTIFICATION_WORKER_ENABLED') === 'true',
      templateName:
        provider === 'whatchimp'
          ? (this.config.get<string>('WHATCHIMP_TEMPLATE_NAME') ?? null)
          : null,
    };
  }
  async webhook(
    provider: string,
    providerEventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    const secret = this.config.get<string>('WHATSAPP_WEBHOOK_SECRET');
    if (!secret || !rawBody || !signature)
      throw new UnauthorizedException('Webhook signature is missing.');
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const valid =
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid)
      throw new UnauthorizedException('Webhook signature is invalid.');
    return this.prisma.webhookEvent.upsert({
      where: { provider_providerEventId: { provider, providerEventId } },
      create: {
        provider,
        providerEventId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
        signatureValid: true,
        processedAt: new Date(),
      },
      update: {},
    });
  }
  private async deliver(
    channel: NotificationChannel,
    to: string,
    subject: string | null,
    body: string,
  ) {
    if (channel === NotificationChannel.EMAIL) {
      const transporter = nodemailer.createTransport({
        host: this.config.getOrThrow('SMTP_HOST'),
        port: Number(this.config.get('SMTP_PORT') ?? 587),
        secure: false,
        auth: {
          user: this.config.getOrThrow('SMTP_USER'),
          pass: this.config.getOrThrow('SMTP_PASSWORD'),
        },
      });
      const result = await transporter.sendMail({
        from: this.config.getOrThrow('SMTP_FROM'),
        to,
        subject: subject ?? 'TechNova POS notification',
        html: this.emailHtml(body),
        text: this.emailText(body),
      });
      return result.messageId;
    }
    if (channel === NotificationChannel.WHATSAPP) {
      const provider = (
        this.config.get<string>('WHATSAPP_PROVIDER') ?? 'meta'
      ).toLowerCase();
      if (provider === 'whatchimp') return this.deliverWithWhatChimp(to, body);
      const token = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN'),
        phoneId = this.config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID'),
        apiVersion =
          this.config.get<string>('WHATSAPP_GRAPH_API_VERSION') ?? 'v23.0';
      const response = await fetch(
        `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body },
          }),
        },
      );
      if (!response.ok)
        throw new BadRequestException(
          `WhatsApp delivery failed (${response.status}).`,
        );
      const result = (await response.json()) as {
        messages?: Array<{ id: string }>;
      };
      return result.messages?.[0]?.id ?? 'accepted';
    }
    throw new BadRequestException(
      `Delivery channel ${channel} is not configured.`,
    );
  }
  private async deliverWithWhatChimp(to: string, body: string) {
    const apiToken = this.config.getOrThrow<string>('WHATCHIMP_API_TOKEN');
    const phoneNumberId = this.config.getOrThrow<string>(
      'WHATCHIMP_PHONE_NUMBER_ID',
    );
    const templateName = this.config.getOrThrow<string>(
      'WHATCHIMP_TEMPLATE_NAME',
    );
    const languageCode =
      this.config.get<string>('WHATCHIMP_LANGUAGE_CODE') ?? 'en_US';
    const baseUrl =
      this.config.get<string>('WHATCHIMP_API_BASE_URL') ??
      'https://app.whatchimp.com/api/v1';
    const phoneNumber = to.replace(/\D/g, '');
    if (!phoneNumber)
      throw new BadRequestException('WhatsApp recipient is invalid.');
    const form = new URLSearchParams({
      apiToken,
      phone_number_id: phoneNumberId,
      phone_number: phoneNumber,
      template_name: templateName,
      language_code: languageCode,
      variable1: body.slice(0, 1024),
    });
    const response = await fetch(`${baseUrl}/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const result = (await response.json().catch(() => null)) as {
      status?: string | number;
      wa_message_id?: string;
      message?: string;
    } | null;
    if (!response.ok || String(result?.status) !== '1')
      throw new BadRequestException(
        result?.message ?? `WhatChimp delivery failed (${response.status}).`,
      );
    return result?.wa_message_id ?? 'accepted';
  }
  private render(
    template: string,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ) {
    let output = template
      .replaceAll('{{eventType}}', eventType)
      .replaceAll('{{payload}}', JSON.stringify(payload));
    if (payload && typeof payload === 'object' && !Array.isArray(payload))
      for (const [key, value] of Object.entries(
        payload as Record<string, unknown>,
      ))
        output = output.replaceAll(`{{${key}}}`, String(value));
    return output;
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
  private emailHtml(value: string) {
    if (/<[a-z][\s\S]*>/i.test(value)) return value;
    return `<div style="font-family:Arial,sans-serif;line-height:1.6">${this.escapeHtml(value).replaceAll('\n', '<br>')}</div>`;
  }
  private emailText(value: string) {
    return value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
  }
  private aggregateId(payload: Prisma.InputJsonValue) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const value: unknown = Object.entries(
        payload as Record<string, unknown>,
      ).find(([key]) => key.endsWith('Id'))?.[1];
      if (typeof value === 'string') return value;
    }
    return 'unknown';
  }
}
