import { ConflictException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DiscountsService } from './discounts.service';
import { UpdateDiscountRuleDto } from './dto/discount.dto';

describe('DiscountsService lifecycle restrictions', () => {
  const actor = { id: 'user-1' } as AuthenticatedUser;
  const context = {} as SecurityRequestContext;
  let service: DiscountsService;
  let discountRule: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    deleteMany: jest.Mock;
  };
  let record: jest.Mock;

  beforeEach(() => {
    discountRule = {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      deleteMany: jest.fn(),
    };
    record = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      discountRule,
    } as unknown as PrismaService;
    service = new DiscountsService(prisma, {
      record,
    } as unknown as AuditService);
  });

  function existingRule(startsAt: Date | null) {
    return {
      id: 'rule-1',
      organizationId: 'org-1',
      name: 'Original',
      minimumQuantity: 2,
      maximumQuantity: null,
      startsAt,
      endsAt: null,
    };
  }

  it('rejects configuration edits after a rule has started', async () => {
    discountRule.findFirst.mockResolvedValue(existingRule(null));
    await expect(
      service.update(actor, 'rule-1', { name: 'Changed' }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(discountRule.update).not.toHaveBeenCalled();
    expect(discountRule.updateMany).not.toHaveBeenCalled();
  });

  it('allows disabling a started rule without editing its configuration', async () => {
    const existing = existingRule(null);
    discountRule.findFirst.mockResolvedValue(existing);
    discountRule.update.mockResolvedValue({ ...existing, status: 'INACTIVE' });
    const dto = Object.assign(new UpdateDiscountRuleDto(), {
      name: undefined,
      startsAt: undefined,
      status: 'INACTIVE' as const,
    });
    await expect(
      service.update(actor, 'rule-1', dto, context),
    ).resolves.toMatchObject({ status: 'INACTIVE' });
    expect(discountRule.update).toHaveBeenCalled();
  });

  it('allows editing a scheduled rule with a database-level start-time guard', async () => {
    const existing = existingRule(new Date(Date.now() + 60_000));
    discountRule.findFirst.mockResolvedValue(existing);
    discountRule.updateMany.mockResolvedValue({ count: 1 });
    discountRule.findUniqueOrThrow.mockResolvedValue({
      ...existing,
      name: 'Changed',
    });
    await expect(
      service.update(actor, 'rule-1', { name: 'Changed' }, context),
    ).resolves.toMatchObject({ name: 'Changed' });
    const updateCalls = discountRule.updateMany.mock.calls as unknown as Array<
      [{ where: { organizationId: string; startsAt: { gt: Date } } }]
    >;
    const updateWhere = updateCalls[0][0].where;
    expect(updateWhere.organizationId).toBe('org-1');
    expect(updateWhere.startsAt.gt).toBeInstanceOf(Date);
  });

  it('rejects deletion after a rule has started or been used', async () => {
    discountRule.findFirst.mockResolvedValue({ id: 'rule-1' });
    discountRule.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.remove(actor, 'rule-1', context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(record).not.toHaveBeenCalled();
  });

  it('deletes an unused scheduled rule and records the action', async () => {
    discountRule.findFirst.mockResolvedValue({ id: 'rule-1' });
    discountRule.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.remove(actor, 'rule-1', context)).resolves.toEqual({
      deleted: true,
    });
    const deleteCalls = discountRule.deleteMany.mock.calls as unknown as Array<
      [
        {
          where: {
            organizationId: string;
            startsAt: { gt: Date };
            applications: { none: Record<string, never> };
          };
        },
      ]
    >;
    const deleteWhere = deleteCalls[0][0].where;
    expect(deleteWhere.organizationId).toBe('org-1');
    expect(deleteWhere.startsAt.gt).toBeInstanceOf(Date);
    expect(deleteWhere.applications).toEqual({ none: {} });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISCOUNT_RULE_DELETED' }),
    );
  });
});
