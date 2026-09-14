export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}
