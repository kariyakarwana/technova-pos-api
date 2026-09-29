export const COLOMBO_TIMEZONE = 'Asia/Colombo';

const colomboDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: COLOMBO_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Format any Date into YYYY-MM-DD in Asia/Colombo timezone.
 */
export function formatColomboDate(date: Date): string {
  return colomboDateFormatter.format(date);
}

/**
 * Safely convert Prisma Decimal, string, or number to a rounded numeric float.
 */
export function safeDecimal(value: unknown, decimals = 2): number {
  if (value === null || value === undefined) return 0.0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0.0;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
  if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    const num = (value as { toNumber: () => number }).toNumber();
    if (!Number.isFinite(num)) return 0.0;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.0;
  const factor = Math.pow(10, decimals);
  return Math.round(parsed * factor) / factor;
}

/**
 * Parse an ISO date or YYYY-MM-DD string into a valid Date object.
 * Returns null if invalid.
 */
export function parseDate(dateStr?: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Resolves dateFrom and dateTo into clean Date boundaries.
 * Clamps maximum duration to 365 days to prevent excessive database scans.
 */
export function resolveDateRange(
  dateFromStr?: string,
  dateToStr?: string,
  defaultDays = 30,
): { start: Date; end: Date; label: string } {
  const now = new Date();
  let end = parseDate(dateToStr) ?? now;
  let start = parseDate(dateFromStr);

  if (!start) {
    start = new Date(end.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  }

  // Ensure start is before end
  if (start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  // Clamp to max 365 days
  const maxSpanMs = 365 * 24 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > maxSpanMs) {
    start = new Date(end.getTime() - maxSpanMs);
  }

  const label = `${formatColomboDate(start)} to ${formatColomboDate(end)}`;
  return { start, end, label };
}
