/**
 * Adds whole calendar months while keeping month-end dates stable.
 * For example, a warranty starting on 31 January ends on 28/29 February.
 */
export function calculateWarrantyEndDate(
  startsAt: Date,
  durationMonths: number,
): Date {
  const endsAt = new Date(startsAt);
  const day = endsAt.getUTCDate();

  endsAt.setUTCDate(1);
  endsAt.setUTCMonth(endsAt.getUTCMonth() + durationMonths);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(endsAt.getUTCFullYear(), endsAt.getUTCMonth() + 1, 0),
  ).getUTCDate();
  endsAt.setUTCDate(Math.min(day, lastDayOfTargetMonth));

  return endsAt;
}
