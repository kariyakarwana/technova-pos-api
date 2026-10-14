import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { isSuperAdmin } from '../../common/auth/privileged-access';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  list() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
  permissions() {
    return this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateRoleDto,
    context: SecurityRequestContext,
  ) {
    if (!isSuperAdmin(actor))
      throw new ForbiddenException(
        'Only a super administrator can manage global roles.',
      );
    const name = dto.name.trim().toUpperCase().replace(/\s+/g, '_');
    if (name === 'SUPER_ADMIN')
      throw new ConflictException('The SUPER_ADMIN role is reserved.');
    await this.validatePermissions(dto.permissionIds);
    try {
      const role = await this.prisma.role.create({
        data: {
          name,
          description: dto.description,
          permissions: {
            create: dto.permissionIds.map((permissionId) => ({ permissionId })),
          },
        },
        include: { permissions: { include: { permission: true } } },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'ROLE_CREATED',
        context,
        metadata: { roleId: role.id },
      });
      return role;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Role name already exists.');
      throw error;
    }
  }
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRoleDto,
    context: SecurityRequestContext,
  ) {
    if (!isSuperAdmin(actor))
      throw new ForbiddenException(
        'Only a super administrator can manage global roles.',
      );
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found.');
    const name = dto.name?.trim().toUpperCase().replace(/\s+/g, '_');
    if (name === 'SUPER_ADMIN' && role.name !== 'SUPER_ADMIN')
      throw new ConflictException('The SUPER_ADMIN role name is reserved.');
    if (role.isSystem && dto.name && dto.name !== role.name)
      throw new ConflictException('System role names cannot be changed.');
    // SUPER_ADMIN must always retain full access. Other built-in roles (for
    // example CASHIER and MANAGER) are templates whose feature access is
    // intentionally configurable by an administrator.
    if (role.name === 'SUPER_ADMIN' && dto.permissionIds)
      throw new ConflictException('SUPER_ADMIN permissions cannot be changed.');
    if (dto.permissionIds) await this.validatePermissions(dto.permissionIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          name,
          description: dto.description,
        },
      });
      if (dto.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: dto.permissionIds.map((permissionId) => ({
            roleId: id,
            permissionId,
          })),
        });
        await tx.user.updateMany({
          where: { roles: { some: { roleId: id } } },
          data: { sessionVersion: { increment: 1 } },
        });
      }
    });
    await this.audit.record({
      userId: actor.id,
      action: 'ROLE_UPDATED',
      context,
      metadata: { roleId: id },
    });
    return { updated: true };
  }
  private async validatePermissions(ids: string[]) {
    if (
      (await this.prisma.permission.count({ where: { id: { in: ids } } })) !==
      ids.length
    )
      throw new ConflictException('One or more permissions are invalid.');
  }
}
