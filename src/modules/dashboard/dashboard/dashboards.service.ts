import {
  BadRequestException,
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
  ApplyTemplateDto,
  CreateDashboardDto,
  DashboardQueryDto,
  UpdateDashboardDto,
  UpdateDashboardLayoutDto,
} from './dto/dashboard.dto';
import { DEFAULT_BACKEND_DASHBOARD_LAYOUT } from './default-dashboard-layout';

@Injectable()
export class DashboardsService {
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

  private async assertBranch(
    organizationId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new BadRequestException('Branch not found in this organization.');
    }
  }

  async list(user: AuthenticatedUser, query: DashboardQueryDto) {
    const organizationId = await this.organizationId(user.id);

    if (query.branchId) {
      await this.assertBranch(organizationId, query.branchId);
    }

    const where: Prisma.DashboardWhereInput = {
      organizationId,
      userId: user.id,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.isDefault !== undefined ? { isDefault: query.isDefault } : {}),
    };

    const count = await this.prisma.dashboard.count({ where });

    if (count === 0) {
      // 2. Safe Fallback: look for organization/branch default dashboard where userId IS NULL
      const fallbackWhere: Prisma.DashboardWhereInput = {
        organizationId,
        userId: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.isDefault !== undefined ? { isDefault: query.isDefault } : {}),
      };

      let fallbackDashboards = await this.prisma.dashboard.findMany({
        where: fallbackWhere,
        skip: query.skip,
        take: query.pageSize,
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });

      // If branch-specific fallback not found, check organization-wide fallback (branchId: null)
      if (fallbackDashboards.length === 0 && query.branchId) {
        fallbackDashboards = await this.prisma.dashboard.findMany({
          where: {
            organizationId,
            userId: null,
            branchId: null,
            ...(query.isDefault !== undefined
              ? { isDefault: query.isDefault }
              : {}),
          },
          skip: query.skip,
          take: query.pageSize,
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          include: {
            branch: { select: { id: true, name: true, code: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        });
      }

      if (fallbackDashboards.length > 0) {
        return paginate(fallbackDashboards, fallbackDashboards.length, query);
      }

      // 3. If neither personal nor organization fallback exists, create a new personal default
      if (query.isDefault) {
        const initial = await this.prisma.dashboard.create({
          data: {
            organizationId,
            userId: user.id,
            branchId: query.branchId || null,
            name: 'My Dashboard',
            isDefault: true,
            layout:
              DEFAULT_BACKEND_DASHBOARD_LAYOUT as unknown as Prisma.InputJsonValue,
          },
          include: {
            branch: { select: { id: true, name: true, code: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        });

        return paginate([initial], 1, query);
      }

      return paginate([], 0, query);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.dashboard.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.dashboard.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async detail(user: AuthenticatedUser, id: string) {
    const organizationId = await this.organizationId(user.id);
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id, organizationId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!dashboard || (dashboard.userId && dashboard.userId !== user.id)) {
      throw new NotFoundException('Dashboard not found.');
    }

    return dashboard;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateDashboardDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    if (dto.branchId) {
      await this.assertBranch(organizationId, dto.branchId);
    }

    if (dto.isDefault) {
      const existingDefault = await this.prisma.dashboard.findFirst({
        where: {
          organizationId,
          userId: user.id,
          branchId: dto.branchId || null,
          isDefault: true,
        },
      });

      if (existingDefault) {
        const updated = await this.prisma.dashboard.update({
          where: { id: existingDefault.id },
          data: {
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            layout: dto.layout as unknown as Prisma.InputJsonValue,
          },
          include: {
            branch: { select: { id: true, name: true, code: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        });

        await this.audit.record({
          userId: user.id,
          action: 'DASHBOARD_UPDATED',
          context,
          metadata: {
            dashboardId: updated.id,
            name: updated.name,
            reason: 'DEFAULT_DASHBOARD_DEDUP_SYNC',
          },
        });

        return updated;
      }
    }

    const dashboard = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.dashboard.updateMany({
          where: {
            organizationId,
            userId: user.id,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      return tx.dashboard.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          branchId: dto.branchId || null,
          userId: user.id,
          isDefault: dto.isDefault ?? false,
          layout: dto.layout as unknown as Prisma.InputJsonValue,
        },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_CREATED',
      context,
      metadata: { dashboardId: dashboard.id, name: dashboard.name },
    });

    return dashboard;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateDashboardDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.dashboard.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Dashboard not found.');
    }

    if (existing.userId !== user.id) {
      throw new ForbiddenException(
        'You can only modify your own personal dashboard.',
      );
    }

    if (dto.branchId) {
      await this.assertBranch(organizationId, dto.branchId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.dashboard.updateMany({
          where: {
            organizationId,
            userId: user.id,
            isDefault: true,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }

      return tx.dashboard.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.branchId !== undefined
            ? { branchId: dto.branchId || null }
            : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_UPDATED',
      context,
      metadata: { dashboardId: id },
    });

    return updated;
  }

  async updateLayout(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateDashboardLayoutDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.dashboard.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Dashboard not found.');
    }

    if (existing.userId && existing.userId !== user.id) {
      throw new ForbiddenException(
        'You can only modify your own personal dashboard.',
      );
    }

    if (existing.userId === null) {
      const personal = await this.prisma.dashboard.create({
        data: {
          organizationId,
          userId: user.id,
          branchId: existing.branchId,
          name: existing.name,
          description: existing.description,
          isDefault: true,
          layout: dto.layout as unknown as Prisma.InputJsonValue,
        },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });

      await this.audit.record({
        userId: user.id,
        action: 'DASHBOARD_CREATED',
        context,
        metadata: {
          dashboardId: personal.id,
          name: personal.name,
          forkedFrom: existing.id,
        },
      });

      return personal;
    }

    const updated = await this.prisma.dashboard.update({
      where: { id },
      data: {
        layout: dto.layout as unknown as Prisma.InputJsonValue,
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_LAYOUT_UPDATED',
      context,
      metadata: { dashboardId: id },
    });

    return updated;
  }

  async delete(
    user: AuthenticatedUser,
    id: string,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.dashboard.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Dashboard not found.');
    }

    if (existing.userId && existing.userId !== user.id) {
      throw new ForbiddenException(
        'You can only delete your own personal dashboard.',
      );
    }

    if (existing.userId === null) {
      throw new ForbiddenException(
        'Cannot delete organization default dashboard.',
      );
    }

    await this.prisma.dashboard.delete({
      where: { id },
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_DELETED',
      context,
      metadata: { dashboardId: id, name: existing.name },
    });

    return { success: true, message: 'Dashboard deleted successfully.' };
  }

  async applyTemplate(
    user: AuthenticatedUser,
    id: string,
    dto: ApplyTemplateDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id, organizationId },
    });
    if (!dashboard) {
      throw new NotFoundException('Dashboard not found.');
    }

    if (dashboard.userId && dashboard.userId !== user.id) {
      throw new ForbiddenException(
        'You can only modify your own personal dashboard.',
      );
    }

    const template = await this.prisma.dashboardTemplate.findFirst({
      where: {
        id: dto.templateId,
        OR: [{ organizationId }, { isSystem: true }],
      },
    });
    if (!template) {
      throw new NotFoundException('Dashboard template not found.');
    }

    const clonedLayout: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify(template.layout),
    ) as Prisma.InputJsonValue;

    if (dashboard.userId === null) {
      const personal = await this.prisma.dashboard.create({
        data: {
          organizationId,
          userId: user.id,
          branchId: dashboard.branchId,
          name: dashboard.name,
          description: dashboard.description,
          isDefault: true,
          layout: clonedLayout,
        },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });

      await this.audit.record({
        userId: user.id,
        action: 'DASHBOARD_TEMPLATE_APPLIED',
        context,
        metadata: {
          dashboardId: personal.id,
          templateId: template.id,
          templateName: template.name,
          forkedFrom: dashboard.id,
        },
      });

      return personal;
    }

    const updated = await this.prisma.dashboard.update({
      where: { id },
      data: {
        layout: clonedLayout,
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await this.audit.record({
      userId: user.id,
      action: 'DASHBOARD_TEMPLATE_APPLIED',
      context,
      metadata: {
        dashboardId: id,
        templateId: template.id,
        templateName: template.name,
      },
    });

    return updated;
  }
}
