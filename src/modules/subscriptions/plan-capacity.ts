import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function assertPlanCapacity(tx: Prisma.TransactionClient, organizationId: string, plan: { billingCycle: string; maxBranches: number; maxInternalUsers: number }) {
  if (plan.billingCycle !== 'MONTHLY') throw new BadRequestException('V1 supports monthly plans only.');
  const [branches, users, extras] = await Promise.all([
    tx.branch.count({ where: { organizationId, status: 'ACTIVE' } }),
    tx.organizationUser.count({ where: { organizationId } }),
    tx.subscriptionAddon.aggregate({ where: { subscription: { organizationId }, isActive: true, addonPack: { quotaTarget: 'BRANCHES' }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, _sum: { grantedUnits: true } }),
  ]);
  if (branches > plan.maxBranches + (extras._sum.grantedUnits ?? 0) || users > plan.maxInternalUsers) throw new BadRequestException('This plan is below current branch or user usage. Reduce usage or select a sufficient plan first.');
}
