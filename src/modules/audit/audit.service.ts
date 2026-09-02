import { Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';

import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginate } from '../../common/dto/pagination.dto';
import { AuditQueryDto } from './audit.dto';

export interface AuditInput {
  userId?: string;
  action: string;
  outcome?: AuditOutcome;
  context?: SecurityRequestContext;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async record(input: AuditInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        userId: input.userId,
        action: input.action,
        outcome: input.outcome ?? AuditOutcome.SUCCESS,
        ipHash: input.context?.ipHash,
        userAgent: input.context?.userAgent,
        metadata: input.metadata,
      },
    });
    await this.notifications.publishFromAudit(
      input.userId,
      input.action,
      input.metadata ?? {},
    );
  }

  async recordFailure(input: Omit<AuditInput, 'outcome'>): Promise<void> {
    await this.record({ ...input, outcome: AuditOutcome.FAILURE });
  }

  async listForUser(userId: string, query: AuditQueryDto) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
      select: { organizationId: true },
    });
    const scope: Prisma.AuditEventWhereInput = membership
      ? {
          user: {
            organizationMemberships: {
              some: { organizationId: membership.organizationId },
            },
          },
        }
      : { userId };
    const where: Prisma.AuditEventWhereInput = {
      AND: [scope],
      action: query.action || undefined,
      outcome: query.outcome,
      createdAt: query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } : undefined,
      OR: query.search ? [
        { action: { contains: query.search, mode: 'insensitive' } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
      ] : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return paginate(data, total, query);
  }
}
