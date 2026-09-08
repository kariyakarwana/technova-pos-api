import { randomUUID } from 'node:crypto';

export function generateInventorySerialNumber(
  sku: string,
  date = new Date(),
  entropy = randomUUID(),
) {
  const prefix =
    sku
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'ITEM';
  const datePart = date.toISOString().slice(0, 10).replaceAll('-', '');
  const uniquePart = entropy.replaceAll('-', '').slice(0, 10).toUpperCase();
  return `${prefix}-${datePart}-${uniquePart}`;
}
