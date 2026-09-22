import { randomBytes } from 'node:crypto';

export function createInternalBarcode(
  timestamp = Date.now(),
  entropy = randomBytes(5).toString('hex'),
) {
  return `TN${timestamp.toString(36)}${entropy}`.toUpperCase();
}
