import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { paginate } from '../../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../../common/security/request';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  CreateDashboardTemplateDto,
  DashboardTemplateQueryDto,
  UpdateDashboardTemplateDto,
} from './dto/dashboard-template.dto';

@Injectable()
export class DashboardTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async organizationId(userId: string): Promise<string> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!membership) {
      throw new NotFoundException('Organization not found.');
    }
    return membership.organizationId;
  }

  async list(user: AuthenticatedUser, query: DashboardTemplateQueryDto) {
    const organizationId = await this.organizationId(user.id);

    const where: Prisma.DashboardTemplateWhereInput = {
      OR: [{ organizationId }, { isSystem: true }],
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            name: { contains: query.search, mode: 'insensitive' },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.dashboardTemplate.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.dashboardTemplate.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async detail(user: AuthenticatedUser, id: string) {
    const organizationId = await this.organizationId(user.id);

    const template = await this.prisma.dashboardTemplate.findFirst({
      where: {
        id,
        OR: [{ organizationId }, { isSystem: true }],
      },
    });

    if (!template) {
      throw new NotFoundException('Dashboard template not found.');
    }

    return template;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateDashboardTemplateDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const template = await this.prisma.dashboardTemplate.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        category: dto.category?.trim() || null,
        isSystem: false,
        layout: dto.layout as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_TEMPLATE_CREATED',
      context,
      metadata: { templateId: template.id, name: template.name },
    });

    return template;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateDashboardTemplateDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.dashboardTemplate.findFirst({
      where: {
        id,
        OR: [{ organizationId }, { isSystem: true }],
      },
    });

    if (!existing) {
      throw new NotFoundException('Dashboard template not found.');
    }

    if (existing.isSystem) {
      throw new ForbiddenException('System templates cannot be modified.');
    }

    if (existing.organizationId !== organizationId) {
      throw new NotFoundException('Dashboard template not found.');
    }

    const updated = await this.prisma.dashboardTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.category !== undefined
          ? { category: dto.category?.trim() || null }
          : {}),
        ...(dto.layout !== undefined
          ? { layout: dto.layout as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_TEMPLATE_UPDATED',
      context,
      metadata: { templateId: id },
    });

    return updated;
  }

  async delete(
    user: AuthenticatedUser,
    id: string,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.dashboardTemplate.findFirst({
      where: {
        id,
        OR: [{ organizationId }, { isSystem: true }],
      },
    });

    if (!existing) {
      throw new NotFoundException('Dashboard template not found.');
    }

    if (existing.isSystem) {
      throw new ForbiddenException('System templates cannot be deleted.');
    }

    if (existing.organizationId !== organizationId) {
      throw new NotFoundException('Dashboard template not found.');
    }

    await this.prisma.dashboardTemplate.delete({
      where: { id },
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_TEMPLATE_DELETED',
      context,
      metadata: { templateId: id, name: existing.name },
    });

    return {
      success: true,
      message: 'Dashboard template deleted successfully.',
    };
  }
}
