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
      await this.notifications.processPending();
    } finally {
      this.running = false;
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
