import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateOrganizationDto } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
}
