import type { AuthenticatedUser } from './authenticated-user';

export const ADMIN_PERMISSION_KEYS = new Set(['users:manage', 'roles:manage']);

export function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.roles.includes('SUPER_ADMIN');
}
