import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
const RESERVED = new Set(['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'SUPPLIER', 'CUSTOMER']);
@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  private async scope(actor: AuthenticatedUser) {
    const memberships = await this.prisma.organizationUser.findMany({ where: { userId: actor.id } });
    if (memberships.length !== 1) throw new ForbiddenException('Exactly one organization membership is required.');
    return memberships[0].organizationId;
  }
  async list(actor: AuthenticatedUser) {
    const scope = await this.scope(actor);
    const roles = await this.prisma.role.findMany({
      where: { scope: { in: ['GLOBAL', scope] }, name: { not: 'PLATFORM_SUPER_ADMIN' } },
      include: { permissions: { include: { permission: true } } }, orderBy: { name: 'asc' },
    });
    const local = new Set(roles.filter(r => r.scope === scope).map(r => r.name));
    return roles.filter(r => r.scope === scope || !local.has(r.name));
  }
  permissions() { return this.prisma.permission.findMany({ orderBy: { key: 'asc' } }); }
  private requireAdmin(actor: AuthenticatedUser) {
    if (!actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Only an organization administrator can manage tenant roles.');
  }
  private async validate(ids: string[]) {
    if (new Set(ids).size !== ids.length || await this.prisma.permission.count({ where: { id: { in: ids } } }) !== ids.length) throw new ConflictException('One or more permissions are invalid.');
  }
  async create(actor: AuthenticatedUser, dto: CreateRoleDto, context: SecurityRequestContext) {
    this.requireAdmin(actor);
    const scope = await this.scope(actor);
    const name = dto.name.trim().toUpperCase().replace(/\s+/g, '_');
    if (RESERVED.has(name)) throw new ConflictException('This role name is reserved.');
    await this.validate(dto.permissionIds);
    const role = await this.prisma.role.create({ data: { scope, name, description: dto.description,
      permissions: { create: dto.permissionIds.map(permissionId => ({ permissionId })) },
    }, include: { permissions: { include: { permission: true } } } });
    await this.audit.record({ userId: actor.id, action: 'ROLE_CREATED', context, metadata: { roleId: role.id, organizationId: scope } });
    return role;
  }
  async update(actor: AuthenticatedUser, id: string, dto: UpdateRoleDto, context: SecurityRequestContext) {
    this.requireAdmin(actor);
    const role = await this.prisma.role.findUnique({ where: { id }, include: { permissions: true } });
    if (!role) throw new NotFoundException('Role not found.');
    if (RESERVED.has(role.name)) throw new ConflictException('System administrator and portal roles are immutable.');
    const scope = await this.scope(actor);
    if (role.scope !== 'GLOBAL' && role.scope !== scope) throw new NotFoundException('Role not found.');
    const name = dto.name?.trim().toUpperCase().replace(/\s+/g, '_') ?? role.name;
    if (RESERVED.has(name)) throw new ConflictException('This role name is reserved.');
    if (dto.permissionIds) await this.validate(dto.permissionIds);
    const updated = await this.prisma.$transaction(async tx => {
      let target = role;
      // Clone a shared template before editing and migrate this tenant's assignments only.
      if (role.scope === 'GLOBAL') {
        const local = await tx.role.upsert({ where: { scope_name: { scope, name: role.name } }, update: {}, create: { scope, name: role.name, description: role.description,
          permissions: { create: role.permissions.map(p => ({ permissionId: p.permissionId })) } }, include: { permissions: true } });
        const members = await tx.userRole.findMany({ where: { roleId: id, user: { organizationMemberships: { some: { organizationId: scope } } } } });
        await tx.userRole.createMany({ data: members.map(m => ({ userId: m.userId, roleId: local.id })), skipDuplicates: true });
        await tx.userRole.deleteMany({ where: { roleId: id, userId: { in: members.map(m => m.userId) } } });
        target = local;
      }
      await tx.role.update({ where: { id: target.id }, data: { name, description: dto.description } });
      if (dto.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: target.id } });
        await tx.rolePermission.createMany({ data: dto.permissionIds.map(permissionId => ({ roleId: target.id, permissionId })) });
      }
      await tx.user.updateMany({ where: { roles: { some: { roleId: target.id } }, organizationMemberships: { some: { organizationId: scope } } }, data: { sessionVersion: { increment: 1 } } });
      return target.id;
    });
    await this.audit.record({ userId: actor.id, action: 'ROLE_UPDATED', context, metadata: { roleId: updated, organizationId: scope } });
    return { updated: true, roleId: updated };
  }
}
