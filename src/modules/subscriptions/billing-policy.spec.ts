import { hasSubscriptionAccess, nextBillingDate } from './billing-policy';

describe('approved monthly billing policy', () => {
  it('clamps February and restores the original month-end anchor in March', () => {
    const feb = nextBillingDate(new Date('2028-01-31T12:00:00Z'), 31);
    expect(feb.toISOString()).toBe('2028-02-29T12:00:00.000Z');
    expect(nextBillingDate(feb, 31).toISOString()).toBe('2028-03-31T12:00:00.000Z');
  });
  it('allows seven days grace but never extends cancellation or administrative suspension', () => {
    const sub = { status: 'ACTIVE', currentPeriodEnd: new Date('2026-11-01T00:00:00Z'), cancelAtPeriodEnd: false };
    expect(hasSubscriptionAccess(sub, new Date('2026-11-07T23:59:59Z'))).toBe(true);
    expect(hasSubscriptionAccess(sub, new Date('2026-11-08T00:00:00Z'))).toBe(false);
    expect(hasSubscriptionAccess({ ...sub, cancelAtPeriodEnd: true }, new Date('2026-11-01T00:00:00Z'))).toBe(false);
    expect(hasSubscriptionAccess({ ...sub, status: 'SUSPENDED' }, new Date('2026-10-31T00:00:00Z'))).toBe(false);
  });
});
