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
  expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400,
): string {
  if (!resourceId || !tenantId || secretKey.length < 32) {
    throw new Error('resourceId, tenantId, and secretKey are required.');
  }

  const signature = createHmac('sha256', secretKey)
    .update(`v1:${resourceId}:${tenantId}:${expiresAt}`)
    .digest('hex')
    .slice(0, 32);
  return `v1.${expiresAt}.${signature}`;
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
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d{10}$/.test(parts[1])) return false;
    const expiresAt = Number(parts[1]);
    if (expiresAt <= Math.floor(Date.now() / 1000)) return false;
    const expected = generateSignedResourceToken(resourceId, tenantId, secretKey, expiresAt);
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
