import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const MAX_TOKEN_LENGTH = 8192;
const CLOCK_SKEW_SECONDS = 60;

let signingKeys: {
  keys: Map<string, KeyObject>;
  expiresAt: number;
  fetchedAt: number;
} | null = null;

type GoogleTokenHeader = { alg?: unknown; kid?: unknown };
type GoogleTokenPayload = {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  email?: unknown;
  email_verified?: unknown;
};

async function loadSigningKeys(forceRefresh = false): Promise<Map<string, KeyObject>> {
  if (!forceRefresh && signingKeys && signingKeys.expiresAt > Date.now())
    return signingKeys.keys;

  const response = await fetch(GOOGLE_CERTS_URL, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Google signing keys are unavailable.');
  const document = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(document.keys))
    throw new Error('Google signing keys are invalid.');

  const keys = new Map<string, KeyObject>();
  for (const candidate of document.keys) {
    if (!candidate || typeof candidate !== 'object') continue;
    const key = candidate as Record<string, unknown>;
    if (
      key.kty !== 'RSA' ||
      key.alg !== 'RS256' ||
      key.use !== 'sig' ||
      typeof key.kid !== 'string' ||
      typeof key.n !== 'string' ||
      typeof key.e !== 'string'
    ) continue;
    keys.set(key.kid, createPublicKey({ key: key as JsonWebKey, format: 'jwk' }));
  }
  if (keys.size === 0) throw new Error('Google signing keys are empty.');

  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAge = Number(/(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl)?.[1] ?? 300);
  signingKeys = {
    keys,
    expiresAt: Date.now() + Math.min(Math.max(maxAge, 0), 86400) * 1000,
    fetchedAt: Date.now(),
  };
  return keys;
}

export async function verifyGoogleIdToken(idToken: string, audience: string) {
  if (!audience || idToken.length > MAX_TOKEN_LENGTH)
    throw new Error('Invalid Google token or audience.');
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
    throw new Error('Invalid Google token format.');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as GoogleTokenHeader;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string')
    throw new Error('Invalid Google signing algorithm.');
  let keys = await loadSigningKeys();
  if (!keys.has(header.kid) && (!signingKeys || Date.now() - signingKeys.fetchedAt > 60_000))
    keys = await loadSigningKeys(true);
  const key = keys.get(header.kid);
  if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url')))
    throw new Error('Invalid Google token signature.');

  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as GoogleTokenPayload;
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== audience ||
    typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.has(payload.iss) ||
    typeof payload.exp !== 'number' || payload.exp <= now ||
    (typeof payload.iat === 'number' && payload.iat > now + CLOCK_SKEW_SECONDS) ||
    (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_SECONDS) ||
    typeof payload.sub !== 'string' || !payload.sub ||
    typeof payload.email !== 'string' || !payload.email ||
    payload.email_verified !== true
  ) throw new Error('Invalid Google token claims.');

  return { sub: payload.sub, email: payload.email.toLowerCase() };
}
