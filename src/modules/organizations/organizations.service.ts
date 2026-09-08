import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type ProductUpload, StorageService } from '../storage/storage.service';
import { UpdateOrganizationDto } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async getForUser(userId: string) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
      include: { organization: { include: { branding: true } } },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organization;
  }

  async updateForUser(
    actor: AuthenticatedUser,
    dto: UpdateOrganizationDto,
    context: SecurityRequestContext,
  ) {
    const current = await this.getForUser(actor.id);
    const { branding, ...organizationData } = dto;
    const updated = await this.prisma.organization.update({
      where: { id: current.id },
      data: {
        ...organizationData,
        currencyCode: organizationData.currencyCode?.toUpperCase(),
        address: organizationData.address,
        branding: branding
          ? {
              upsert: {
                create: branding,
                update: branding,
              },
            }
          : undefined,
      },
      include: { branding: true },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'ORGANIZATION_UPDATED',
      context,
      metadata: { organizationId: current.id },
    });
    return updated;
  }

  async uploadLogo(
    actor: AuthenticatedUser,
    file: ProductUpload | undefined,
    context: SecurityRequestContext,
  ) {
    if (!file)
      throw new BadRequestException('Select a company logo to upload.');
    const current = await this.getForUser(actor.id);
    const stored = await this.storage.uploadOrganizationLogo(current.id, file);
    const updated = await this.prisma.organization
      .update({
        where: { id: current.id },
        data: {
          branding: {
            upsert: {
              create: {
                logoUrl: stored.url,
                logoObjectKey: stored.objectKey,
                logoBucket: stored.bucket,
                logoContentType: stored.contentType,
                logoSizeBytes: stored.sizeBytes,
              },
              update: {
                logoUrl: stored.url,
                logoObjectKey: stored.objectKey,
                logoBucket: stored.bucket,
                logoContentType: stored.contentType,
                logoSizeBytes: stored.sizeBytes,
              },
            },
          },
        },
        include: { branding: true },
      })
      .catch(async (error: unknown) => {
        await this.storage.remove(stored.bucket, stored.objectKey);
        throw error;
      });
    await this.storage.remove(
      current.branding?.logoBucket ?? null,
      current.branding?.logoObjectKey ?? null,
    );
    await this.audit.record({
      userId: actor.id,
      action: 'ORGANIZATION_LOGO_UPLOADED',
      context,
      metadata: { organizationId: current.id },
    });
    return updated;
  }

  async removeLogo(actor: AuthenticatedUser, context: SecurityRequestContext) {
    const current = await this.getForUser(actor.id);
    const updated = await this.prisma.organization.update({
      where: { id: current.id },
      data: {
        branding: current.branding
          ? {
              update: {
                logoUrl: null,
                logoObjectKey: null,
                logoBucket: null,
                logoContentType: null,
                logoSizeBytes: null,
              },
            }
          : undefined,
      },
      include: { branding: true },
    });
    await this.storage.remove(
      current.branding?.logoBucket ?? null,
      current.branding?.logoObjectKey ?? null,
    );
    await this.audit.record({
      userId: actor.id,
      action: 'ORGANIZATION_LOGO_REMOVED',
      context,
      metadata: { organizationId: current.id },
    });
    return updated;
  }
}
