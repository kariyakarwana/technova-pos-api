import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { BILLING_GRACE_MS, nextBillingDate } from './billing-policy';
import { invoiceSnapshot } from './invoice-snapshot';
import { queueBillingReminders } from './billing-reminders';

@Injectable()
export class BillingLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(BillingLifecycleService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  onApplicationBootstrap() {
    if (this.config.get('BILLING_WORKER_ENABLED') !== 'true') return;
    const run = () => void this.reconcile().catch(e => this.logger.error(e));
    this.timer = setInterval(run, 3600000); this.timer.unref(); run();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
  async reconcile(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      let cursor: string | undefined;
      for (;;) {
        const due = await this.prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { lte: new Date(now.getTime() + BILLING_GRACE_MS) } }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!due.length) break;
        for (const item of due) await this.prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${item.id}`}))`;
          const sub = await tx.subscription.findUniqueOrThrow({ where: { id: item.id }, include: { plan: true, addons: { where: { isActive: true }, include: { addonPack: true } } } });
          if (!['ACTIVE', 'TRIALING'].includes(sub.status)) return;
          const start = sub.currentPeriodEnd;
          const end = nextBillingDate(start, sub.billingAnchorDay);
          if (sub.cancelAtPeriodEnd) {
            await tx.subscriptionInvoice.updateMany({ where: { subscriptionId: sub.id, periodStart: { gte: start }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
            if (now >= start) await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });
            return;
          }
          if (start.getTime() > now.getTime() + BILLING_GRACE_MS) return;
          const recurring = sub.addons.filter(a => a.addonPack?.billingCycle === 'MONTHLY');
          const lines = [{ description: sub.plan.name, quantity: 1, unitPriceUsd: sub.plan.priceUsd.toString(), amountUsd: sub.plan.priceUsd.toString() }, ...recurring.map(a => ({ description: a.type, quantity: a.quantity, unitPriceUsd: a.priceUsd.div(a.quantity).toString(), amountUsd: a.priceUsd.toString() }))];
          const subtotal = recurring.reduce((sum, a) => sum.add(a.priceUsd), new Prisma.Decimal(sub.plan.priceUsd));
          const tax = subtotal.mul(sub.plan.vatRate).toDecimalPlaces(2);
          const key = `${sub.id}:${start.toISOString()}`;
          await tx.subscriptionInvoice.upsert({ where: { billingPeriodKey: key }, update: {}, create: {
            subscriptionId: sub.id, invoiceNumber: `RENEW-${sub.id}-${start.getTime()}`, billingPeriodKey: key,
            subtotalUsd: subtotal, vatAmountUsd: tax, totalAmountUsd: subtotal.add(tax), dueDate: new Date(start.getTime() + BILLING_GRACE_MS),
            ...await invoiceSnapshot(tx, sub.id, lines, { start, end }, sub.plan),
          } });
          if (now >= start) {
            await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } });
            await tx.subscriptionAddon.updateMany({ where: { id: { in: recurring.map(a => a.id) } }, data: { expiresAt: end } });
            await tx.auditEvent.create({ data: { action: 'SUBSCRIPTION_PERIOD_RENEWED', outcome: 'SUCCESS', metadata: { subscriptionId: sub.id, periodStart: start.toISOString(), periodEnd: end.toISOString() } } });
          }
        });
        cursor = due[due.length - 1].id;
      }
      await this.prisma.subscriptionInvoice.updateMany({ where: { status: 'PENDING', dueDate: { lte: now } }, data: { status: 'OVERDUE' } });
      await this.prisma.subscription.updateMany({ where: { status: { in: ['ACTIVE', 'TRIALING'] }, invoices: { some: { status: 'OVERDUE' } } }, data: { status: 'PAST_DUE' } });
      await this.dispatchReminders(now);
    } finally { this.running = false; }
  }
  async dispatchReminders(now = new Date()) {
    const publicUrl = this.config.get<string>('PUBLIC_FRONTEND_URL') || this.config.getOrThrow<string>('FRONTEND_URL');
    return this.prisma.$transaction(tx => queueBillingReminders(tx, now, publicUrl), { timeout: 60000 });
  }
}
