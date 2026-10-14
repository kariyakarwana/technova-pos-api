import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyGoogleIdToken } from './google-id-token';

describe('verifyGoogleIdToken', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const audience = 'technova-mobile.apps.googleusercontent.com';
  const keyId = 'test-google-key';
  const jwk = publicKey.export({ format: 'jwk' });

  const token = (claims: Record<string, unknown>, signingKey = privateKey) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: audience,
      sub: 'google-user-1',
      email: 'Customer@Example.com',
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })).toString('base64url');
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), signingKey).toString('base64url');
    return `${header}.${payload}.${signature}`;
  };

  beforeAll(() => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [{ ...jwk, kid: keyId, alg: 'RS256', use: 'sig' }] }),
      headers: { get: () => 'max-age=300' },
    } as unknown as Response);
  });

  afterAll(() => jest.restoreAllMocks());

  it('accepts a signed Google ID token for the configured audience', async () => {
    await expect(verifyGoogleIdToken(token({}), audience)).resolves.toEqual({
      sub: 'google-user-1', email: 'customer@example.com',
    });
  });

  it('rejects another audience, an expired token, and unverified email', async () => {
    await expect(verifyGoogleIdToken(token({ aud: 'other-client' }), audience)).rejects.toThrow();
    await expect(verifyGoogleIdToken(token({ exp: 1 }), audience)).rejects.toThrow();
    await expect(verifyGoogleIdToken(token({ email_verified: false }), audience)).rejects.toThrow();
  });

  it('rejects a forged signature', async () => {
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyGoogleIdToken(token({}, otherKey), audience)).rejects.toThrow();
  });
});
