import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma/prisma.service';
import { AuthRepository } from './auth.repository';

describe('AuthRepository customer Google links', () => {
  it('does not accept browser Google links as customer mobile links', async () => {
    const prisma = { account: { findUnique: jest.fn().mockResolvedValue(null) } };
    const repository = new AuthRepository(prisma as unknown as PrismaService);
    await expect(repository.findCustomerUserForGoogleSub('google-sub-1'))
      .resolves.toBeNull();
    expect(prisma.account.findUnique).toHaveBeenCalledWith({
      where: { provider_providerAccountId: {
        provider: 'google_customer_mobile', providerAccountId: 'google-sub-1',
      } },
      include: expect.any(Object),
    });
  });

  it('does not relink a Google account already owned by another user', async () => {
    const prisma = {
      account: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'other-user' }),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const repository = new AuthRepository(prisma as unknown as PrismaService);
    await expect(repository.linkGoogleToCustomer('customer-user-1', 'google-sub-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.account.create).not.toHaveBeenCalled();
  });
});
