import { Prisma } from '@prisma/client';

/** Durable outbox idempotency is per invoice/stage/recipient, across manual and scheduled runs. */
export async function queueBillingReminders(tx: Prisma.TransactionClient, now: Date, publicUrl: string) {
  let cursor: string | undefined;
  let queued = 0;
  for (;;) {
    const invoices = await tx.subscriptionInvoice.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lte: new Date(now.getTime() + 14 * 86400000) } },
      include: { subscription: { include: { organization: { include: { users: { where: { user: { status: 'ACTIVE', roles: { some: { role: { name: 'SUPER_ADMIN' } } } } }, include: { user: { select: { id: true, email: true } } } } } } } } },
      orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!invoices.length) break;
    for (const invoice of invoices) {
      const stage = now >= invoice.dueDate ? 'OVERDUE' : invoice.periodStart && now >= invoice.periodStart ? 'DUE' : 'UPCOMING';
      const link = new URL('/dashboard/billing', publicUrl).toString();
      const body = `Invoice ${invoice.invoiceNumber}: USD ${invoice.totalAmountUsd.toFixed(2)}. Payment deadline: ${invoice.dueDate.toISOString().slice(0, 10)}. Please arrange manual settlement with NxCodeWorks. View billing: ${link}`;
      for (const member of invoice.subscription.organization.users) {
        const key = `billing:${invoice.id}:${stage}:${member.user.id}`;
        const result = await tx.notificationOutbox.createMany({ data: [{ channel: 'EMAIL', recipient: member.user.email, subject: `TechNova billing: ${stage.toLowerCase()}`, body, idempotencyKey: key }], skipDuplicates: true });
        if (result.count) {
          await tx.appNotification.create({ data: { organizationId: invoice.subscription.organizationId, recipientUserId: member.user.id, eventType: 'BILLING_PAYMENT_REMINDER', title: `Subscription invoice ${stage.toLowerCase()}`, message: body, actionUrl: '/dashboard/billing' } });
          queued++;
        }
      }
    }
    cursor = invoices[invoices.length - 1].id;
  }
  return { queued };
}
