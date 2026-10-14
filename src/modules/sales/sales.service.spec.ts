import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CreateSaleDto } from './dto/sale.dto';
import { SalesService } from './sales.service';

describe('SalesService branch authorization', () => {
  const dto = {
    branchId: 'branch-2',
    payments: [],
  } as unknown as CreateSaleDto;
  const context = {} as SecurityRequestContext;

  it('requires a branch assignment even when the cashier can view branches', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new SalesService(
      prisma as unknown as PrismaService,
      {} as AuditService,
    );

    await expect(
      service.create(
        {
          id: 'cashier-1',
          roles: ['CASHIER'],
          permissions: ['sales:manage', 'branches:view'],
        } as AuthenticatedUser,
        dto,
        context,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'branch-2',
        organizationId: 'org-1',
        status: 'ACTIVE',
        users: { some: { userId: 'cashier-1' } },
      },
    });
  });

  it('does not require a super-admin branch assignment in the sale lookup', async () => {
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new SalesService(
      prisma as unknown as PrismaService,
      {} as AuditService,
    );

    await expect(
      service.create(
        {
          id: 'admin-1',
          email: 'admin@example.com',
          name: 'Admin',
          roles: ['SUPER_ADMIN'],
          permissions: [],
        } as AuthenticatedUser,
        dto,
        context,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'branch-2',
        organizationId: 'org-1',
        status: 'ACTIVE',
        users: undefined,
      },
    });
  });
});
