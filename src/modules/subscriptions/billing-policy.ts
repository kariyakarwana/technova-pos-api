export const BILLING_GRACE_MS = 7 * 86400000;

/** Calendar month in UTC, clamped to the original billing anchor day. */
export function nextBillingDate(start: Date, anchorDay = start.getUTCDate()): Date {
  const next = new Date(start);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, last));
  return next;
}

export function hasSubscriptionAccess(sub: { status: string; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean; invoices?: unknown[] } | null | undefined, now = new Date()) {
  if (!sub || sub.invoices?.length || !['ACTIVE', 'TRIALING'].includes(sub.status)) return false;
  const deadline = sub.currentPeriodEnd.getTime() + (sub.cancelAtPeriodEnd ? 0 : BILLING_GRACE_MS);
  return now.getTime() < deadline;
}
