import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Generates an unguessable HMAC-SHA256 signature token for public URLs
 * (e.g. digital receipts and invoices) to prevent IDOR / enumeration attacks.
 *
 * Team Lead Security Requirement: UUID + Cryptographic Token in public URL.
 */
export function generateSignedResourceToken(
  resourceId: string,
  tenantId: string,
  secretKey: string,
): string {
  if (!resourceId || !tenantId || !secretKey) {
    throw new Error('resourceId, tenantId, and secretKey are required.');
  }

  return createHmac('sha256', secretKey)
    .update(`${resourceId}:${tenantId}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Verifies a token in constant-time to prevent timing attacks.
 */
export function verifySignedResourceToken(
  resourceId: string,
  tenantId: string,
  token: string,
  secretKey: string,
): boolean {
  if (!resourceId || !tenantId || !token || !secretKey) {
    return false;
  }

  try {
    const expected = generateSignedResourceToken(resourceId, tenantId, secretKey);
    const tokenBuffer = Buffer.from(token, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (tokenBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(tokenBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
