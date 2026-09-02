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
  PreferenceDto,
  UpdateTemplateDto,
} from './dto/notification.dto';
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
            ? this.render(template.subjectTemplate, eventType, payload)
            : undefined,
          body: this.render(template.bodyTemplate, eventType, payload),
          idempotencyKey: `${event.id}:${template.id}:${recipient}`,
        },
      });
    }
    await this.prisma.domainEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  }
  async templates(userId: string) {
    const organizationId = await this.org(userId);
    return this.prisma.notificationTemplate.findMany({
      where: { organizationId },
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
    });
  }
  async createTemplate(userId: string, dto: CreateTemplateDto) {
    const organizationId = await this.org(userId);
    return this.prisma.notificationTemplate.upsert({
      where: {
        organizationId_eventType_channel: {
          organizationId,
          eventType: dto.eventType,
          channel: dto.channel,
        },
      },
      create: { ...dto, organizationId },
      update: dto,
    });
  }
  async updateTemplate(userId: string, id: string, dto: UpdateTemplateDto) {
    const organizationId = await this.org(userId);
    if (
      !(await this.prisma.notificationTemplate.findFirst({
        where: { id, organizationId },
      }))
    )
      throw new NotFoundException('Notification template not found.');
    return this.prisma.notificationTemplate.update({
      where: { id },
      data: dto,
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
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notificationOutbox.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { attempts: { take: 5, orderBy: { attemptedAt: 'desc' } } },
      }),
      this.prisma.notificationOutbox.count({ where }),
    ]);
    return paginate(data, total, q);
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
      workerEnabled:
        this.config.get<string>('NOTIFICATION_WORKER_ENABLED') === 'true',
      templateName:
        provider === 'whatchimp'
          ? this.config.get<string>('WHATCHIMP_TEMPLATE_NAME') ?? null
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
        html: body,
      });
      return result.messageId;
    }
    if (channel === NotificationChannel.WHATSAPP) {
      const provider = (
        this.config.get<string>('WHATSAPP_PROVIDER') ?? 'meta'
      ).toLowerCase();
      if (provider === 'whatchimp')
        return this.deliverWithWhatChimp(to, body);
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
