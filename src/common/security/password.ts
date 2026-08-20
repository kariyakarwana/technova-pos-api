import { compare, hash } from 'bcryptjs';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const BCRYPT_COST_FACTOR = 12;

export type PasswordValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validates password complexity.
 *
 * Passwords must:
 * - Contain 12–128 characters
 * - Have an uppercase letter
 * - Have a lowercase letter
 * - Have a number
 * - Have a symbol
 */
export function validatePasswordStrength(
  password: string,
): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(
      `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters.`);
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter.');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number.');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one symbol.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a bcrypt password hash.
 *
 * Never store or log the original password.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error('Password is required.');
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error('Password exceeds the maximum supported length.');
  }

  return hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Compares a submitted password with its stored bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!password || !passwordHash) {
    return false;
  }

  try {
    return await compare(password, passwordHash);
  } catch {
    // An invalid/corrupted hash should be treated as failed authentication.
    return false;
  }
}
