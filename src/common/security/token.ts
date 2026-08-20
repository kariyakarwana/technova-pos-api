import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const TOKEN_BYTE_LENGTH = 32;

export const EMAIL_VERIFICATION_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

export const PASSWORD_RESET_TOKEN_LIFETIME_MS = 30 * 60 * 1000;

export type GeneratedSecurityToken = {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
};

/**
 * Generates a cryptographically secure 32-byte token.
 *
 * The returned base64url value is safe to include in a URL.
 */
export function generateRawToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

/**
 * Produces the SHA-256 digest stored in PostgreSQL.
 *
 * Store this hash in security_tokens.tokenHash.
 * Never store the raw token.
 */
export function hashToken(rawToken: string): string {
  if (!rawToken) {
    throw new Error('Token is required.');
  }

  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function createEmailVerificationToken(
  now = new Date(),
): GeneratedSecurityToken {
  const rawToken = generateRawToken();

  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_LIFETIME_MS),
  };
}

export function createPasswordResetToken(
  now = new Date(),
): GeneratedSecurityToken {
  const rawToken = generateRawToken();

  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_LIFETIME_MS),
  };
}

export function isTokenExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Constant-time comparison for two SHA-256 hex digests.
 */
export function compareTokenHashes(
  firstHash: string,
  secondHash: string,
): boolean {
  try {
    const first = Buffer.from(firstHash, 'hex');
    const second = Buffer.from(secondHash, 'hex');

    if (
      first.length !== 32 ||
      second.length !== 32 ||
      first.length !== second.length
    ) {
      return false;
    }

    return timingSafeEqual(first, second);
  } catch {
    return false;
  }
}

export const PASSWORD_RESET_OTP_LENGTH = 6;

export const PASSWORD_RESET_OTP_LIFETIME_MS = 10 * 60 * 1000;

export const PASSWORD_RESET_GRANT_LIFETIME_MS = 10 * 60 * 1000;

export type GeneratedPasswordResetOtp = {
  challengeToken: string;
  challengeHash: string;
  otp: string;
  otpHash: string;
  expiresAt: Date;
};

function getOtpPepper(): string {
  const pepper =
    process.env.AUTH_OTP_PEPPER?.trim() ??
    process.env.JWT_ACCESS_PRIVATE_KEY?.trim();

  if (!pepper) {
    throw new Error('AUTH_OTP_PEPPER is required.');
  }

  return pepper;
}

export function generateOtp(): string {
  return randomInt(0, 1_000_000)
    .toString()
    .padStart(PASSWORD_RESET_OTP_LENGTH, '0');
}

export function hashOtp(challengeToken: string, otp: string): string {
  return createHmac('sha256', getOtpPepper())
    .update(`${challengeToken}:${otp}`, 'utf8')
    .digest('hex');
}

export function createPasswordResetOtp(
  now = new Date(),
): GeneratedPasswordResetOtp {
  const challengeToken = generateRawToken();

  const otp = generateOtp();

  return {
    challengeToken,
    challengeHash: hashToken(challengeToken),
    otp,
    otpHash: hashOtp(challengeToken, otp),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_OTP_LIFETIME_MS),
  };
}
