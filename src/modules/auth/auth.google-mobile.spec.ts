import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { RecordStatus, UserStatus } from '@prisma/client';
import type { SecurityRequestContext } from '../../common/security/request';
import type { AuthRepository, CustomerLoginUser } from './auth.repository';
import { AuthService } from './auth.service';
import { verifyGoogleIdToken } from './google-id-token';

jest.mock('./google-id-token', () => ({ verifyGoogleIdToken: jest.fn() }));

describe('AuthService customer Google mobile login', () => {
  const context = { ipHash: 'ip-hash', userAgent: 'mobile' } as SecurityRequestContext;
  const customerUser = {
    id: 'customer-user-1',
    email: 'customer@example.com',
    phone: '+94771234567',
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    mustChangePassword: false,
    roles: [{ role: { name: 'CUSTOMER', permissions: [{ permission: { key: 'customer-app:access' } }] } }],
    customerProfile: {
      id: 'customer-1',
      status: RecordStatus.ACTIVE,
      firstName: 'Saman',
      lastName: 'Perera',
      customerNumber: 'CUS-001',
    },
  } as CustomerLoginUser;

  const makeService = () => {
    const repository = {
      findCustomerUserById: jest.fn().mockResolvedValue(customerUser),
      findCustomerUserForGoogleSub: jest.fn().mockResolvedValue(customerUser),
      linkGoogleToCustomer: jest.fn().mockResolvedValue(undefined),
      createRefreshSession: jest.fn().mockResolvedValue(undefined),
      recordSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('technova-access-token') };
    const config = {
      get: jest.fn((key: string) => key === 'GOOGLE_MOBILE_SERVER_CLIENT_ID' ? 'web-client-id' : 'jwt-secret'),
    };
    const service = new AuthService(
      repository as unknown as AuthRepository,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
    return { service, repository };
  };

  beforeEach(() => {
    jest.mocked(verifyGoogleIdToken).mockResolvedValue({
      sub: 'google-sub-1', email: 'customer@example.com',
    });
  });

  it('issues mobile tokens only for a pre-linked active customer', async () => {
    const { service, repository } = makeService();
    const result = await service.loginGoogleCustomer('google-id-token', context);
    expect(repository.findCustomerUserForGoogleSub).toHaveBeenCalledWith('google-sub-1');
    expect(result.data.user).toEqual(expect.objectContaining({
      id: 'customer-user-1', firstName: 'Saman', customerNumber: 'CUS-001',
    }));
    expect(result.data.tokens.accessToken).toBe('technova-access-token');
    expect(repository.createRefreshSession).toHaveBeenCalledTimes(1);
  });

  it('rejects an unlinked Google account without creating a session', async () => {
    const { service, repository } = makeService();
    repository.findCustomerUserForGoogleSub.mockResolvedValue(null);
    await expect(service.loginGoogleCustomer('google-id-token', context))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.createRefreshSession).not.toHaveBeenCalled();
  });

  it('requires an active customer-only account for linking', async () => {
    const { service, repository } = makeService();
    repository.findCustomerUserById.mockResolvedValue({
      ...customerUser, roles: [{ role: { name: 'SUPER_ADMIN', permissions: [] } }],
    } as unknown as CustomerLoginUser);
    await expect(service.linkGoogleCustomer('staff-1', 'google-id-token'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.linkGoogleToCustomer).not.toHaveBeenCalled();
  });

  it('does not link a Google account with a different email', async () => {
    const { service, repository } = makeService();
    jest.mocked(verifyGoogleIdToken).mockResolvedValue({
      sub: 'google-sub-1', email: 'other@example.com',
    });
    await expect(service.linkGoogleCustomer('customer-user-1', 'google-id-token'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.linkGoogleToCustomer).not.toHaveBeenCalled();
  });

  it('links Google only after the existing customer is authenticated', async () => {
    const { service, repository } = makeService();
    await expect(service.linkGoogleCustomer('customer-user-1', 'google-id-token'))
      .resolves.toEqual({ linked: true });
    expect(repository.linkGoogleToCustomer).toHaveBeenCalledWith('customer-user-1', 'google-sub-1');
  });
});
