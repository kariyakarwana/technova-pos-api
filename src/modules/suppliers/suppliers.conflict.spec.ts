import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService.create uniqueness errors', () => {
  const prisma = {
    organizationUser: { findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) },
    $transaction: jest.fn(),
  };
  const service = new SuppliersService(prisma as never, {} as never, {} as never);
  const actor = { id: 'admin-1' } as AuthenticatedUser;
  const context = {} as SecurityRequestContext;
  const dto = {
    code: 'SUP-123',
    name: 'Test supplier',
    email: 'employee@example.com',
    portalEnabled: true,
  };

  function uniqueError(target?: string[]) {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.9.1',
      meta: target ? { target } : undefined,
    });
  }

  beforeEach(() => jest.clearAllMocks());

  it('shows an email-specific message for an existing user account', async () => {
    prisma.$transaction.mockRejectedValueOnce(uniqueError(['email']));

    await expect(service.create(actor, dto, context)).rejects.toThrow(
      new ConflictException('This email address is already registered to an existing account.'),
    );
  });

  it('does not blame the email for a generated supplier ID collision', async () => {
    prisma.$transaction.mockRejectedValueOnce(uniqueError(['organizationId', 'code']));

    await expect(service.create(actor, dto, context)).rejects.toThrow(
      new ConflictException('The supplier could not be created. Refresh the form and try again.'),
    );
  });

  it('does not mention supplier code when constraint metadata is unavailable', async () => {
    prisma.$transaction.mockRejectedValueOnce(uniqueError());

    await expect(service.create(actor, dto, context)).rejects.toThrow(
      new ConflictException('The supplier could not be created. Refresh the form and try again.'),
    );
  });
});
