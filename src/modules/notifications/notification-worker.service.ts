import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InstallmentStatus,
  NotificationChannel,
  RecordStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
@Injectable()
export class NotificationWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private deliveryTimer?: NodeJS.Timeout;
  private reminderTimer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  onApplicationBootstrap() {
    if (this.config.get('NOTIFICATION_WORKER_ENABLED') !== 'true') return;
    this.deliveryTimer = setInterval(() => void this.process(), 30_000);
    this.reminderTimer = setInterval(
      () => void this.generateOperationalAlerts(),
      60 * 60_000,
    );
    this.deliveryTimer.unref();
    this.reminderTimer.unref();
    void this.process();
    void this.generateOperationalAlerts();
  }
  onApplicationShutdown() {
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    if (this.reminderTimer) clearInterval(this.reminderTimer);
  }
  private async process() {
    if (this.running) return;
    this.running = true;
    try {
      await this.promotionLaunches();
      await this.notifications.processPending();
    } finally {
      this.running = false;
    }
  }

  private async promotionLaunches() {
    const now = new Date();
    const promotions = await this.prisma.discountRule.findMany({
      where: {
        status: RecordStatus.ACTIVE,
        promotionNotifiedAt: null,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          { OR: [{ notifyEmail: true }, { notifyWhatsapp: true }] },
        ],
      },
      include: { organization: true, product: true },
    });
    for (const promotion of promotions) {
      const customers = await this.prisma.customer.findMany({
        where: {
          organizationId: promotion.organizationId,
          status: RecordStatus.ACTIVE,
          OR: [{ email: { not: null } }, { phone: { not: null } }],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      });
      const [templates, preferences] = await Promise.all([
        this.prisma.notificationTemplate.findMany({
          where: {
            organizationId: promotion.organizationId,
            eventType: 'PROMOTION_STARTED',
          },
        }),
        this.prisma.notificationPreference.findMany({
          where: {
            customerId: { in: customers.map((customer) => customer.id) },
            eventType: 'PROMOTION_STARTED',
          },
        }),
      ]);
      const templateByChannel = new Map(
        templates.map((template) => [template.channel, template]),
      );
      const disabled = new Set(
        preferences
          .filter((preference) => !preference.enabled)
          .map(
            (preference) => `${preference.customerId}:${preference.channel}`,
          ),
      );
      const offer =
        promotion.type === 'PERCENTAGE'
          ? `${Number(promotion.value)}% off`
          : promotion.type === 'FIXED_AMOUNT'
            ? `LKR ${Number(promotion.value).toLocaleString()} off`
            : `LKR ${Number(promotion.value).toLocaleString()} promotional price`;
      const payload = {
        companyName: promotion.organization.name,
        promotionId: promotion.id,
        promotionName: promotion.name,
        promotionCode: promotion.code ?? '',
        description: promotion.description ?? '',
        offer,
        product: promotion.product?.name ?? 'eligible products',
        startsAt: promotion.startsAt?.toISOString() ?? now.toISOString(),
        endsAt: promotion.endsAt?.toISOString() ?? 'while stocks last',
      };
      const messages: Array<{
        templateId?: string;
        channel: NotificationChannel;
        recipient: string;
        subject?: string;
        body: string;
        idempotencyKey: string;
      }> = [];
      for (const customer of customers) {
        const customerName =
          `${customer.firstName} ${customer.lastName ?? ''}`.trim();
        for (const channel of [
          NotificationChannel.EMAIL,
          NotificationChannel.WHATSAPP,
        ]) {
          const enabled =
            channel === NotificationChannel.EMAIL
              ? promotion.notifyEmail
              : promotion.notifyWhatsapp;
          const recipient =
            channel === NotificationChannel.EMAIL
              ? customer.email
              : customer.phone;
          const template = templateByChannel.get(channel);
          if (
            !enabled ||
            !recipient ||
            disabled.has(`${customer.id}:${channel}`) ||
            (template && template.status !== RecordStatus.ACTIVE)
          )
            continue;
          const customerPayload = { ...payload, customerName };
          messages.push({
            templateId: template?.id,
            channel,
            recipient,
            subject:
              channel === NotificationChannel.EMAIL
                ? template?.subjectTemplate
                  ? this.render(template.subjectTemplate, customerPayload)
                  : `${promotion.name} is now available at ${promotion.organization.name}`
                : undefined,
            body: template
              ? this.render(template.bodyTemplate, customerPayload)
              : channel === NotificationChannel.EMAIL
                ? `<p>Hello ${customerName},</p><p><strong>${promotion.name}</strong> is now available at ${promotion.organization.name}.</p><p>${offer} on ${payload.product}.</p>${promotion.description ? `<p>${promotion.description}</p>` : ''}${promotion.code ? `<p>Promotion code: <strong>${promotion.code}</strong></p>` : ''}`
                : `Hello ${customerName}! ${promotion.name} is now available at ${promotion.organization.name}: ${offer} on ${payload.product}.${promotion.code ? ` Code: ${promotion.code}.` : ''}${promotion.description ? ` ${promotion.description}` : ''}`,
            idempotencyKey: `promotion-start:${promotion.id}:${customer.id}:${channel}`,
          });
        }
      }
      await this.prisma.$transaction(async (transaction) => {
        const event = await transaction.domainEvent.create({
          data: {
            organizationId: promotion.organizationId,
            aggregateType: 'PROMOTION',
            aggregateId: promotion.id,
            eventType: 'PROMOTION_STARTED',
            payload,
          },
        });
        if (messages.length)
          await transaction.notificationOutbox.createMany({
            data: messages.map((message) => ({
              ...message,
              domainEventId: event.id,
            })),
            skipDuplicates: true,
          });
        await transaction.discountRule.update({
          where: { id: promotion.id },
          data: { promotionNotifiedAt: now },
        });
      });
    }
  }
  private async generateOperationalAlerts() {
    await this.creditReminders();
    await this.lowStockAlerts();
  }
  private async creditReminders() {
    const now = new Date(),
      until = new Date(Date.now() + 3 * 24 * 60 * 60_000),
      day = now.toISOString().slice(0, 10);
    const installments = await this.prisma.creditInstallment.findMany({
      where: {
        dueDate: { lte: until },
        status: {
          in: [
            InstallmentStatus.PENDING,
            InstallmentStatus.PARTIALLY_PAID,
            InstallmentStatus.OVERDUE,
          ],
        },
        creditAgreement: {
          customer: { phone: { not: null }, status: RecordStatus.ACTIVE },
        },
      },
      include: { creditAgreement: { include: { customer: true } } },
    });
    for (const item of installments) {
      const customer = item.creditAgreement.customer;
      if (!customer.phone) continue;
      const preference = await this.prisma.notificationPreference.findUnique({
        where: {
          customerId_channel_eventType: {
            customerId: customer.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: 'CREDIT_PAYMENT_REMINDER',
          },
        },
      });
      if (preference?.enabled === false) continue;
      const template = await this.prisma.notificationTemplate.findFirst({
        where: {
          organizationId: customer.organizationId,
          eventType: 'CREDIT_PAYMENT_REMINDER',
          channel: NotificationChannel.WHATSAPP,
          status: RecordStatus.ACTIVE,
        },
      });
      if (!template) continue;
      const key = `credit-reminder:${item.id}:${day}`;
      if (
        await this.prisma.notificationOutbox.findUnique({
          where: { idempotencyKey: key },
        })
      )
        continue;
      const payload = {
        customerNumber: customer.customerNumber,
        installmentId: item.id,
        dueDate: item.dueDate.toISOString(),
        amountDue: Number(item.amountDue) - Number(item.amountPaid),
      };
      const event = await this.prisma.domainEvent.create({
        data: {
          organizationId: customer.organizationId,
          aggregateType: 'CREDIT_INSTALLMENT',
          aggregateId: item.id,
          eventType: 'CREDIT_PAYMENT_REMINDER',
          payload,
        },
      });
      await this.prisma.notificationOutbox.create({
        data: {
          domainEventId: event.id,
          templateId: template.id,
          channel: NotificationChannel.WHATSAPP,
          recipient: customer.phone,
          body: this.render(template.bodyTemplate, payload),
          idempotencyKey: key,
        },
      });
    }
  }
  private async lowStockAlerts() {
    const day = new Date().toISOString().slice(0, 10);
    const levels = await this.prisma.stockLevel.findMany({
      include: { product: true, branch: { include: { organization: true } } },
    });
    for (const level of levels.filter(
      (row) => Number(row.quantityOnHand) <= Number(row.product.reorderLevel),
    )) {
      const organization = level.branch.organization;
      if (!organization.phone) continue;
      const template = await this.prisma.notificationTemplate.findFirst({
        where: {
          organizationId: organization.id,
          eventType: 'LOW_STOCK_ALERT',
          channel: NotificationChannel.WHATSAPP,
          status: RecordStatus.ACTIVE,
        },
      });
      if (!template) continue;
      const key = `low-stock:${level.branchId}:${level.productId}:${day}`;
      if (
        await this.prisma.notificationOutbox.findUnique({
          where: { idempotencyKey: key },
        })
      )
        continue;
      const payload = {
        branch: level.branch.name,
        sku: level.product.sku,
        product: level.product.name,
        quantity: Number(level.quantityOnHand),
        reorderLevel: Number(level.product.reorderLevel),
      };
      const event = await this.prisma.domainEvent.create({
        data: {
          organizationId: organization.id,
          aggregateType: 'PRODUCT',
          aggregateId: level.productId,
          eventType: 'LOW_STOCK_ALERT',
          payload,
        },
      });
      await this.prisma.notificationOutbox.create({
        data: {
          domainEventId: event.id,
          templateId: template.id,
          channel: NotificationChannel.WHATSAPP,
          recipient: organization.phone,
          body: this.render(template.bodyTemplate, payload),
          idempotencyKey: key,
        },
      });
    }
  }
  private render(template: string, payload: Record<string, unknown>) {
    let value = template;
    for (const [key, item] of Object.entries(payload))
      value = value.replaceAll(`{{${key}}}`, String(item));
    return value;
  }
}
