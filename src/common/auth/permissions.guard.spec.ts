import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function context(user: { roles: string[]; permissions: string[] }): ExecutionContext {
  return { getHandler: () => function handler() {}, getClass: () => class Controller {}, switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector);
  beforeEach(() => jest.clearAllMocks());

  it('allows routes without declared permissions', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(context({ roles: ['CASHIER'], permissions: [] }))).toBe(true);
  });
  it('allows SUPER_ADMIN regardless of assigned permissions', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['roles:manage']);
    expect(guard.canActivate(context({ roles: ['SUPER_ADMIN'], permissions: [] }))).toBe(true);
  });
  it('allows a cashier only when every required permission is assigned', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales:create', 'customers:view']);
    expect(guard.canActivate(context({ roles: ['CASHIER'], permissions: ['sales:create', 'customers:view'] }))).toBe(true);
  });
  it('rejects branch and inventory roles missing one required permission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['inventory:view', 'inventory:manage']);
    expect(() => guard.canActivate(context({ roles: ['BRANCH_MANAGER'], permissions: ['inventory:view'] }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context({ roles: ['INVENTORY_MANAGER'], permissions: [] }))).toThrow(ForbiddenException);
  });
});
