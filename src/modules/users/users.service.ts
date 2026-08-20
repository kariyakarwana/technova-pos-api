import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';
import { hashPassword } from '../../common/security/password';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserAccessDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async organizationId(userId: string) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organizationId;
  }

  async list(actorId: string, query: PaginationDto) {
    const organizationId = await this.organizationId(actorId);
    const where = { organizationMemberships: { some: { organizationId } } };
    const select = {
      id: true,
      email: true,
      name: true,
      status: true,
      emailVerified: true,
      lastLoginAt: true,
      createdAt: true,
      roles: { select: { role: { select: { id: true, name: true } } } },
      branchAssignments: {
        select: {
          isDefault: true,
          branch: { select: { id: true, code: true, name: true } },
        },
      },
    } satisfies Prisma.UserSelect;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateUserDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.validateAssignments(organizationId, dto.roleIds, dto.branchIds);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          name: dto.name.trim(),
          passwordHash: await hashPassword(dto.password),
          emailVerified: new Date(),
          status: UserStatus.ACTIVE,
          organizationMemberships: { create: { organizationId } },
          roles: { create: dto.roleIds.map((roleId) => ({ roleId })) },
          branchAssignments: {
            create: dto.branchIds.map((branchId, index) => ({
              branchId,
              isDefault: index === 0,
            })),
          },
        },
        select: { id: true, email: true, name: true, status: true },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'USER_CREATED',
        context,
        metadata: { targetUserId: user.id },
      });
      return user;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('A user with this email already exists.');
      throw error;
    }
  }

  async updateAccess(
    actor: AuthenticatedUser,
    targetUserId: string,
    dto: UpdateUserAccessDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    const target = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationMemberships: { some: { organizationId } },
      },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (dto.roleIds || dto.branchIds)
      await this.validateAssignments(
        organizationId,
        dto.roleIds ?? [],
        dto.branchIds ?? [],
      );
    if (dto.defaultBranchId && !dto.branchIds?.includes(dto.defaultBranchId))
      throw new ConflictException(
        'Default branch must be assigned to the user.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          name: dto.name,
          status: dto.status,
          sessionVersion: { increment: 1 },
        },
      });
      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: targetUserId } });
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({ userId: targetUserId, roleId })),
        });
      }
      if (dto.branchIds) {
        await tx.userBranch.deleteMany({ where: { userId: targetUserId } });
        await tx.userBranch.createMany({
          data: dto.branchIds.map((branchId) => ({
            userId: targetUserId,
            branchId,
            isDefault: branchId === (dto.defaultBranchId ?? dto.branchIds?.[0]),
          })),
        });
      }
      await tx.refreshSession.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'ACCESS_CHANGED' },
      });
    });
    await this.audit.record({
      userId: actor.id,
      action: 'USER_ACCESS_UPDATED',
      context,
      metadata: { targetUserId },
    });
    return { updated: true };
  }

  private async validateAssignments(
    organizationId: string,
    roleIds: string[],
    branchIds: string[],
  ) {
    const [roleCount, branchCount] = await Promise.all([
      this.prisma.role.count({ where: { id: { in: roleIds } } }),
      this.prisma.branch.count({
        where: { id: { in: branchIds }, organizationId },
      }),
    ]);
    if (roleCount !== roleIds.length || branchCount !== branchIds.length)
      throw new ConflictException(
        'One or more role or branch assignments are invalid.',
      );
  }
}
