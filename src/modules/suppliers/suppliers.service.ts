import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../../common/security/password';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}
  private async organizationId(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async list(userId: string, query: PaginationDto) {
    const organizationId = await this.organizationId(userId);
    const where = { organizationId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: {
          users: {
            select: {
              isPrimary: true,
              user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
            },
          },
        },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return paginate(data, total, query);
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateSupplierDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    if (dto.portalEnabled && !dto.email)
      throw new BadRequestException(
        'An email address is required when supplier portal access is enabled.',
      );
    const temporaryPassword = dto.portalEnabled
      ? `Tn1!${randomBytes(12).toString('base64url')}`
      : undefined;
    let portalUserId: string | undefined;
    try {
      const supplier = await this.prisma.$transaction(async (tx) => {
        const created = await tx.supplier.create({
          data: {
            ...dto,
            code: dto.code.trim().toUpperCase(),
            organizationId,
            address: dto.address,
          },
        });
        if (dto.portalEnabled && temporaryPassword) {
          portalUserId = await this.createPortalUser(
            tx,
            organizationId,
            created.id,
            dto.email!,
            dto.contactName ?? dto.name,
            temporaryPassword,
          );
        }
        return created;
      });
      if (dto.portalEnabled && temporaryPassword) {
        try {
          await this.auth.sendSupplierWelcomeEmail(
            dto.email!,
            dto.contactName ?? dto.name,
            temporaryPassword,
          );
        } catch {
          await this.prisma.$transaction(async (tx) => {
            if (portalUserId)
              await tx.user.delete({ where: { id: portalUserId } });
            await tx.supplier.delete({ where: { id: supplier.id } });
          });
          throw new ServiceUnavailableException(
            'The supplier welcome email could not be delivered, so the supplier was not created. Check the SMTP settings and try again.',
          );
        }
      }
      await this.audit.record({
        userId: actor.id,
        action: 'SUPPLIER_CREATED',
        context,
        metadata: { supplierId: supplier.id },
      });
      return { ...supplier, temporaryPasswordSent: Boolean(temporaryPassword) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'The supplier code or portal email is already in use.',
        );
      throw error;
    }
  }
  async detail(userId: string, id: string) {
    const organizationId = await this.organizationId(userId);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, organizationId },
      include: {
        users: {
          select: {
            isPrimary: true,
            user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
          },
        },
        purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    return supplier;
  }
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSupplierDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    const existing = await this.prisma.supplier.findFirst({
      where: { id, organizationId },
      include: { users: { include: { user: true } } },
    });
    if (!existing)
      throw new NotFoundException('Supplier not found.');
    if (dto.portalEnabled && !(dto.email ?? existing.email))
      throw new BadRequestException(
        'An email address is required when supplier portal access is enabled.',
      );
    const needsAccount = dto.portalEnabled === true && existing.users.length === 0;
    const temporaryPassword = needsAccount
      ? `Tn1!${randomBytes(12).toString('base64url')}`
      : undefined;
    let portalUserId: string | undefined;
    const supplier = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id },
        data: { ...dto, address: dto.address },
      });
      if (needsAccount && temporaryPassword) {
        portalUserId = await this.createPortalUser(
          tx,
          organizationId,
          id,
          (dto.email ?? existing.email)!,
          dto.contactName ?? existing.contactName ?? dto.name ?? existing.name,
          temporaryPassword,
        );
      } else if (dto.portalEnabled !== undefined && existing.users.length) {
        await tx.user.updateMany({
          where: { id: { in: existing.users.map(({ userId }) => userId) } },
          data: {
            status: dto.portalEnabled ? UserStatus.ACTIVE : UserStatus.INACTIVE,
            sessionVersion: { increment: 1 },
          },
        });
      } else if (dto.status !== undefined && existing.users.length) {
        await tx.user.updateMany({
          where: { id: { in: existing.users.map(({ userId }) => userId) } },
          data: {
            status:
              dto.status === 'ACTIVE' && existing.portalEnabled
                ? UserStatus.ACTIVE
                : UserStatus.INACTIVE,
            sessionVersion: { increment: 1 },
          },
        });
      }
      return updated;
    });
    if (temporaryPassword) {
      try {
        await this.auth.sendSupplierWelcomeEmail(
          (dto.email ?? existing.email)!,
          dto.contactName ?? existing.contactName ?? dto.name ?? existing.name,
          temporaryPassword,
        );
      } catch {
        if (portalUserId)
          await this.prisma.user.delete({ where: { id: portalUserId } });
        await this.prisma.supplier.update({
          where: { id },
          data: { portalEnabled: false },
        });
        throw new ServiceUnavailableException(
          'Portal access was not enabled because the welcome email could not be delivered. Check the SMTP settings and try again.',
        );
      }
    }
    await this.audit.record({
      userId: actor.id,
      action: 'SUPPLIER_UPDATED',
      context,
      metadata: { supplierId: id },
    });
    return { ...supplier, temporaryPasswordSent: Boolean(temporaryPassword) };
  }

  private async createPortalUser(
    tx: Prisma.TransactionClient,
    organizationId: string,
    supplierId: string,
    email: string,
    name: string,
    temporaryPassword: string,
  ) {
    const permission = await tx.permission.upsert({
      where: { key: 'supplier-portal:access' },
      update: { description: 'Access the assigned supplier portal' },
      create: {
        key: 'supplier-portal:access',
        description: 'Access the assigned supplier portal',
      },
    });
    const role = await tx.role.upsert({
      where: { name: 'SUPPLIER' },
      update: { description: 'External supplier portal user', isSystem: true },
      create: {
        name: 'SUPPLIER',
        description: 'External supplier portal user',
        isSystem: true,
      },
    });
    await tx.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: role.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
    const user = await tx.user.create({
      data: {
        email: email.trim().toLowerCase(),
        name: name.trim(),
        passwordHash: await hashPassword(temporaryPassword),
        emailVerified: new Date(),
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
        organizationMemberships: { create: { organizationId } },
        roles: { create: { roleId: role.id } },
        supplierMembership: {
          create: { supplierId, isPrimary: true },
        },
      },
      select: { id: true },
    });
    return user.id;
  }
}
