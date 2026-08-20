import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WarrantyStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { hashToken } from '../../common/security/token';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateWarrantyPolicyDto,
  UpdateWarrantyPolicyDto,
} from './dto/warranty.dto';
@Injectable()
export class WarrantiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async organizationId(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async policies(userId: string) {
    const org = await this.organizationId(userId);
    return this.prisma.warrantyPolicy.findMany({
      where: { product: { organizationId: org } },
      include: { product: { select: { id: true, sku: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }
  async createPolicy(
    actor: AuthenticatedUser,
    dto: CreateWarrantyPolicyDto,
    context: SecurityRequestContext,
  ) {
    const org = await this.organizationId(actor.id);
    if (
      !(await this.prisma.product.findFirst({
        where: { id: dto.productId, organizationId: org },
      }))
    )
      throw new NotFoundException('Product not found.');
    const value = await this.prisma.warrantyPolicy.create({ data: dto });
    await this.audit.record({
      userId: actor.id,
      action: 'WARRANTY_POLICY_CREATED',
      context,
      metadata: { warrantyPolicyId: value.id },
    });
    return value;
  }
  async updatePolicy(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateWarrantyPolicyDto,
    context: SecurityRequestContext,
  ) {
    const org = await this.organizationId(actor.id);
    if (
      !(await this.prisma.warrantyPolicy.findFirst({
        where: { id, product: { organizationId: org } },
      }))
    )
      throw new NotFoundException('Warranty policy not found.');
    const value = await this.prisma.warrantyPolicy.update({
      where: { id },
      data: dto,
    });
    await this.audit.record({
      userId: actor.id,
      action: 'WARRANTY_POLICY_UPDATED',
      context,
      metadata: { warrantyPolicyId: id },
    });
    return value;
  }
  async scan(rawToken: string) {
    const unit = await this.prisma.inventoryUnit.findUnique({
      where: { qrCodeHash: hashToken(rawToken) },
      include: {
        product: {
          select: {
            sku: true,
            barcode: true,
            name: true,
            description: true,
            brand: { select: { name: true } },
            category: { select: { name: true } },
          },
        },
        warranty: {
          select: {
            status: true,
            activatedAt: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });
    if (!unit) throw new NotFoundException('QR code is invalid.');
    return {
      serialNumber: unit.serialNumber,
      unitStatus: unit.status,
      product: unit.product,
      warranty: unit.warranty,
    };
  }
  async activate(rawToken: string) {
    const grant = await this.prisma.qrAccessGrant.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { warranty: { include: { warrantyPolicy: true } } },
    });
    if (!grant || grant.expiresAt <= new Date())
      throw new UnauthorizedException('Activation link is invalid or expired.');
    if (grant.usedAt || grant.warranty.status !== WarrantyStatus.PENDING)
      throw new ConflictException(
        'This warranty activation link has already been used.',
      );
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setMonth(
      endsAt.getMonth() + grant.warranty.warrantyPolicy.durationMonths,
    );
    return this.prisma.$transaction(async (tx) => {
      const used = await tx.qrAccessGrant.updateMany({
        where: { id: grant.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!used.count)
        throw new ConflictException(
          'This warranty activation link has already been used.',
        );
      const warranty = await tx.warranty.update({
        where: { id: grant.warrantyId },
        data: {
          status: WarrantyStatus.ACTIVE,
          activatedAt: startsAt,
          startsAt,
          endsAt,
        },
      });
      await tx.warrantyEvent.create({
        data: {
          warrantyId: warranty.id,
          eventType: 'ACTIVATED',
          occurredAt: startsAt,
        },
      });
      return { activated: true, warrantyId: warranty.id, startsAt, endsAt };
    });
  }
}
