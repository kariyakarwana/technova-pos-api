import {
  BadRequestException,
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
  CreateVisualThemeDto,
  UpdateVisualThemeDto,
  VisualThemeQueryDto,
} from './dto/visual-theme.dto';

@Injectable()
export class VisualThemesService {
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

  async list(user: AuthenticatedUser, query: VisualThemeQueryDto) {
    const organizationId = await this.organizationId(user.id);

    const where: Prisma.VisualThemeWhereInput = {
      organizationId,
      ...(query.isDefault !== undefined ? { isDefault: query.isDefault } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.visualTheme.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.visualTheme.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async detail(user: AuthenticatedUser, id: string) {
    const organizationId = await this.organizationId(user.id);

    const theme = await this.prisma.visualTheme.findFirst({
      where: { id, organizationId },
    });

    if (!theme) {
      throw new NotFoundException('Visual theme not found.');
    }

    return theme;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateVisualThemeDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const themeCount = await this.prisma.visualTheme.count({
      where: { organizationId },
    });

    // If it's the very first theme for the organization, default it automatically
    const shouldBeDefault = dto.isDefault ?? themeCount === 0;

    const theme = await this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.visualTheme.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.visualTheme.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          isDefault: shouldBeDefault,
          tokens: dto.tokens as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      action: 'VISUAL_THEME_CREATED',
      context,
      metadata: { themeId: theme.id, name: theme.name },
    });

    return theme;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateVisualThemeDto,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.visualTheme.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Visual theme not found.');
    }

    if (dto.isDefault === false && existing.isDefault) {
      const otherThemesCount = await this.prisma.visualTheme.count({
        where: { organizationId, NOT: { id } },
      });
      if (otherThemesCount > 0) {
        throw new BadRequestException(
          'Cannot unset the default theme directly. Designate another theme as default instead.',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.visualTheme.updateMany({
          where: { organizationId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return tx.visualTheme.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.tokens !== undefined
            ? { tokens: dto.tokens as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      action: 'VISUAL_THEME_UPDATED',
      context,
      metadata: { themeId: id },
    });

    return updated;
  }

  async setDefault(
    user: AuthenticatedUser,
    id: string,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.visualTheme.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Visual theme not found.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.visualTheme.updateMany({
        where: { organizationId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });

      return tx.visualTheme.update({
        where: { id },
        data: { isDefault: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      action: 'VISUAL_THEME_DEFAULT_CHANGED',
      context,
      metadata: { themeId: id, name: existing.name },
    });

    return updated;
  }

  async delete(
    user: AuthenticatedUser,
    id: string,
    context?: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(user.id);

    const existing = await this.prisma.visualTheme.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Visual theme not found.');
    }

    if (existing.isDefault) {
      const otherThemes = await this.prisma.visualTheme.count({
        where: { organizationId, NOT: { id } },
      });
      if (otherThemes > 0) {
        throw new BadRequestException(
          'Cannot delete the active default theme. Designate another theme as default before deleting this one.',
        );
      }
    }

    await this.prisma.visualTheme.delete({
      where: { id },
    });

    await this.audit.record({
      userId: user.id,
      action: 'VISUAL_THEME_DELETED',
      context,
      metadata: { themeId: id, name: existing.name },
    });

    return { success: true, message: 'Visual theme deleted successfully.' };
  }
}
