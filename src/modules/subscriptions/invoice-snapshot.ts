import { Prisma } from '@prisma/client';

/** Called inside the transaction which issues an invoice. Never reads live prices for historic invoices. */
export async function invoiceSnapshot(tx: Prisma.TransactionClient, subscriptionId: string, lines?: Prisma.InputJsonValue, period?: { start: Date; end: Date }, pricing?: { name: string; code: string; priceUsd: Prisma.Decimal; vatRate: Prisma.Decimal }) {
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { plan: true, organization: true } });
  const plan = pricing ?? sub.plan;
  return {
    currency: 'USD',
    vatRateSnapshot: plan.vatRate,
    periodStart: period?.start ?? sub.currentPeriodStart,
    periodEnd: period?.end ?? sub.currentPeriodEnd,
    customerSnapshot: { name: sub.organization.name, email: sub.organization.email, registrationNumber: sub.organization.registrationNumber, planName: plan.name, planCode: plan.code },
    lineItems: lines ?? [{ description: plan.name, quantity: 1, unitPriceUsd: plan.priceUsd.toString(), amountUsd: plan.priceUsd.toString() }],
  };
}
