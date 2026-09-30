import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RecordStatus, SaleStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AdjustLoyaltyPointsDto,
  CreateLoyaltyRuleDto,
  UpdateLoyaltyRuleDto,
} from './dto/loyalty.dto';

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async organizationId(userId: string) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
      select: { organizationId: true },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organizationId;
  }

  async rules(userId: string) {
    const organizationId = await this.organizationId(userId);
    const rules = await this.prisma.loyaltyRule.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return {
      activeRule: rules.find((rule) => rule.status === RecordStatus.ACTIVE) ?? null,
      rules,
      defaultRule: rules.length
        ? null
        : {
            name: 'Standard loyalty rule',
            spendAmount: 1000,
            pointsAwarded: 50,
            redemptionValuePerPoint: 1,
          },
    };
  }

  async createRule(
    actor: AuthenticatedUser,
    dto: CreateLoyaltyRuleDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    const rule = await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyRule.updateMany({
        where: { organizationId, status: RecordStatus.ACTIVE },
        data: { status: RecordStatus.INACTIVE },
      });
      return tx.loyaltyRule.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          spendAmount: dto.spendAmount,
          pointsAwarded: dto.pointsAwarded,
          redemptionValuePerPoint: dto.redemptionValuePerPoint ?? 1,
        },
      });
    });
    await this.audit.record({
      userId: actor.id,
      action: 'LOYALTY_RULE_CREATED',
      context,
      metadata: { ruleId: rule.id, ...dto },
    });
    return rule;
  }

  async updateRule(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateLoyaltyRuleDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    const existing = await this.prisma.loyaltyRule.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Loyalty rule not found.');
    const rule = await this.prisma.$transaction(async (tx) => {
      if (dto.status === RecordStatus.ACTIVE) {
        await tx.loyaltyRule.updateMany({
          where: { organizationId, status: RecordStatus.ACTIVE, id: { not: id } },
          data: { status: RecordStatus.INACTIVE },
        });
      }
      return tx.loyaltyRule.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          spendAmount: dto.spendAmount,
          pointsAwarded: dto.pointsAwarded,
          redemptionValuePerPoint: dto.redemptionValuePerPoint,
          status: dto.status,
        },
      });
    });
    await this.audit.record({
      userId: actor.id,
      action: 'LOYALTY_RULE_UPDATED',
      context,
      metadata: { ruleId: rule.id, ...dto },
    });
    return rule;
  }

  async customer(userId: string, customerId: string) {
    const organizationId = await this.organizationId(userId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: {
        id: true,
        customerNumber: true,
        firstName: true,
        lastName: true,
        loyaltyAccount: {
          include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    const activeRule = await this.prisma.loyaltyRule.findFirst({
      where: { organizationId, status: RecordStatus.ACTIVE },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      ...customer,
      balance: customer.loyaltyAccount?.points ?? 0,
      redemptionValue:
        (customer.loyaltyAccount?.points ?? 0) * Number(activeRule?.redemptionValuePerPoint ?? 1),
      activeRule: activeRule ?? {
        name: 'Standard loyalty rule',
        spendAmount: 1000,
        pointsAwarded: 50,
        redemptionValuePerPoint: 1,
      },
    };
  }

  async adjust(
    actor: AuthenticatedUser,
    customerId: string,
    dto: AdjustLoyaltyPointsDto,
    context: SecurityRequestContext,
  ) {
    if (dto.points === 0) throw new BadRequestException('Points adjustment cannot be zero.');
    const organizationId = await this.organizationId(actor.id);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    const result = await this.prisma.$transaction(async (tx) => {
      const account = await tx.loyaltyAccount.upsert({
        where: { customerId },
        create: { customerId, points: 0 },
        update: {},
      });
      if (account.points + dto.points < 0)
        throw new ConflictException('The adjustment would make the loyalty balance negative.');
      const updated = await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { points: { increment: dto.points } },
      });
      await tx.loyaltyTransaction.create({
        data: {
          loyaltyAccountId: account.id,
          points: dto.points,
          reason: `ADMIN_ADJUSTMENT: ${dto.reason.trim()}`,
          referenceType: 'ADMIN_ADJUSTMENT',
          referenceId: actor.id,
        },
      });
      return updated;
    });
    await this.audit.record({
      userId: actor.id,
      action: 'LOYALTY_POINTS_ADJUSTED',
      context,
      metadata: { customerId, points: dto.points, reason: dto.reason },
    });
    return result;
  }

  async ruleRecommendations(userId: string) {
    const organizationId = await this.organizationId(userId);
    const since = new Date();
    since.setUTCFullYear(since.getUTCFullYear() - 1);
    const [currentRule, leaders] = await Promise.all([
      this.prisma.loyaltyRule.findFirst({
        where: { organizationId, status: RecordStatus.ACTIVE },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.sale.groupBy({
        by: ['customerId'],
        where: {
          customerId: { not: null },
          branch: { organizationId },
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
          createdAt: { gte: since },
        },
        _sum: { total: true },
        _count: { id: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 1,
      }),
    ]);
    const leader = leaders[0]?.customerId
      ? await this.prisma.customer.findFirst({
          where: { id: leaders[0].customerId, organizationId },
          select: { id: true, customerNumber: true, firstName: true, lastName: true },
        })
      : null;
    return {
      generatedAt: new Date().toISOString(),
      suggestions: [
        {
          id: 'balanced-spend-rate',
          title: 'Balanced spend reward',
          description: 'Award 50 points for every LKR 1,000 of eligible spend.',
          spendAmount: 1000,
          pointsAwarded: 50,
          redemptionValuePerPoint: 1,
          estimatedRewardRatePercent: 5,
          recommended: !currentRule,
        },
        {
          id: 'top-customer-yearly-bonus',
          title: 'Top customer of the year bonus',
          description: leader
            ? `Consider awarding 100,000 bonus points to ${leader.firstName} ${leader.lastName ?? ''} for leading annual spend.`.trim()
            : 'Collect more completed customer sales before selecting an annual top-customer bonus.',
          bonusPoints: 100000,
          customer: leader,
          evidence: leaders[0]
            ? { annualSpend: Number(leaders[0]._sum.total ?? 0), orders: leaders[0]._count.id }
            : null,
          recommended: Boolean(leader),
        },
      ],
      currentRule,
      note: 'Suggestions require administrator approval and never award points automatically.',
    };
  }
}
