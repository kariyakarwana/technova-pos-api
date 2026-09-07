import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async organizationId(userId: string): Promise<string> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organizationId;
  }

  async list(user: AuthenticatedUser, query: PaginationDto) {
    const organizationId = await this.organizationId(user.id);
    const canViewAll = user.permissions.includes('branches:view');
    const where: Prisma.BranchWhereInput = {
      organizationId,
      users: canViewAll ? undefined : { some: { userId: user.id } },
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.branch.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateBranchDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    try {
      const branch = await this.prisma.branch.create({
        data: {
          ...dto,
          code: dto.code.trim().toUpperCase(),
          organizationId,
          address: dto.address,
        },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'BRANCH_CREATED',
        context,
        metadata: { branchId: branch.id },
      });
      return branch;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Branch code already exists.');
      throw error;
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateBranchDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    const existing = await this.prisma.branch.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Branch not found.');
    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...dto,
        address: dto.address,
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'BRANCH_UPDATED',
      context,
      metadata: { branchId: id },
    });
    return branch;
  }
}
