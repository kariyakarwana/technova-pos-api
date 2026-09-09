import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import { hashPassword } from '../../common/security/password';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateUserDto, UpdateUserAccessDto, UserQueryDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  private async organizationId(userId: string) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organizationId;
  }

  async list(actorId: string, query: UserQueryDto) {
    const organizationId = await this.organizationId(actorId);
    const where: Prisma.UserWhereInput = {
      organizationMemberships: { some: { organizationId } },
      status: query.status,
      roles: query.roleId ? { some: { roleId: query.roleId } } : undefined,
      branchAssignments: query.branchId
        ? { some: { branchId: query.branchId } }
        : undefined,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
          ]
        : undefined,
    };
    const select = {
      id: true,
      email: true,
      name: true,
      phone: true,
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
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw new NotFoundException('Organization not found.');
    await this.validateAssignments(organizationId, dto.roleIds, dto.branchIds);
    const temporaryPassword = `Tn1!${randomBytes(12).toString('base64url')}`;
    let user: {
      id: string;
      email: string;
      name: string | null;
      phone: string | null;
      status: UserStatus;
    };
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          passwordHash: await hashPassword(temporaryPassword),
          emailVerified: new Date(),
          status: UserStatus.ACTIVE,
          mustChangePassword: true,
          organizationMemberships: { create: { organizationId } },
          roles: { create: dto.roleIds.map((roleId) => ({ roleId })) },
          branchAssignments: {
            create: dto.branchIds.map((branchId, index) => ({
              branchId,
              isDefault: index === 0,
            })),
          },
        },
        select: { id: true, email: true, name: true, phone: true, status: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('A user with this email already exists.');
      throw error;
    }
    try {
      await this.auth.sendEmployeeWelcomeEmail(
        user.email,
        user.name ?? dto.name.trim(),
        temporaryPassword,
      );
    } catch {
      await this.prisma.user.delete({ where: { id: user.id } });
      throw new ServiceUnavailableException(
        'The employee email could not be delivered, so the account was not created. Check the SMTP settings and try again.',
      );
    }
    let whatsappQueued = false;
    try {
      const welcome = await this.notifications.queueEmployeeWelcomeWhatsapp({
        organizationId,
        companyName: organization.name,
        employeeId: user.id,
        employeeName: user.name ?? dto.name.trim(),
        email: user.email,
        phone: user.phone ?? dto.phone.trim(),
      });
      whatsappQueued = welcome.queued;
    } catch (error) {
      this.logger.error(
        `Employee ${user.id} was created, but the WhatsApp welcome message could not be queued.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    await this.audit.record({
      userId: actor.id,
      action: 'USER_CREATED',
      context,
      metadata: { targetUserId: user.id },
    });
    return { ...user, temporaryPasswordSent: true, whatsappQueued };
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
    if (targetUserId === actor.id && dto.status && dto.status !== UserStatus.ACTIVE)
      throw new ConflictException('You cannot deactivate your own account.');
    if (dto.status && dto.status !== UserStatus.ACTIVE)
      await this.assertNotLastSuperAdmin(organizationId, targetUserId);
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
          phone: dto.phone?.trim(),
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

  async remove(
    actor: AuthenticatedUser,
    targetUserId: string,
    context: SecurityRequestContext,
  ) {
    if (targetUserId === actor.id)
      throw new ConflictException('You cannot delete your own account.');
    const organizationId = await this.organizationId(actor.id);
    const target = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationMemberships: { some: { organizationId } },
      },
      select: { id: true, email: true },
    });
    if (!target) throw new NotFoundException('User not found.');
    await this.assertNotLastSuperAdmin(organizationId, targetUserId);
    try {
      await this.prisma.user.delete({ where: { id: targetUserId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new ConflictException(
          'This employee has business history and cannot be permanently deleted. Deactivate the employee instead.',
        );
      throw error;
    }
    await this.audit.record({
      userId: actor.id,
      action: 'USER_DELETED',
      context,
      metadata: { targetUserId, targetEmail: target.email },
    });
    return { deleted: true };
  }

  private async assertNotLastSuperAdmin(
    organizationId: string,
    targetUserId: string,
  ) {
    const targetIsSuperAdmin = await this.prisma.user.count({
      where: {
        id: targetUserId,
        roles: { some: { role: { name: 'SUPER_ADMIN' } } },
        organizationMemberships: { some: { organizationId } },
      },
    });
    if (!targetIsSuperAdmin) return;
    const activeSuperAdmins = await this.prisma.user.count({
      where: {
        status: UserStatus.ACTIVE,
        roles: { some: { role: { name: 'SUPER_ADMIN' } } },
        organizationMemberships: { some: { organizationId } },
      },
    });
    if (activeSuperAdmins <= 1)
      throw new ConflictException(
        'The organization must keep at least one active super administrator.',
      );
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
