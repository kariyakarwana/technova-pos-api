import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type DiscountRule,
  Prisma,
  RecordStatus,
  SaleStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateDiscountRuleDto,
  UpdateDiscountRuleDto,
} from './dto/discount.dto';
@Injectable()
export class DiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async org(userId: string) {
    const m = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!m) throw new NotFoundException('Organization not found.');
    return m.organizationId;
  }
  async list(userId: string) {
    const organizationId = await this.org(userId);
    return this.prisma.discountRule.findMany({
      where: { organizationId },
      include: { product: { select: { id: true, sku: true, name: true } } },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    });
  }
  async dashboard(userId: string) {
    const organizationId = await this.org(userId);
    const rules = await this.prisma.discountRule.findMany({
      where: { organizationId },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        applications: {
          include: {
            saleItem: {
              select: {
                quantity: true,
                lineTotal: true,
                sale: {
                  select: {
                    id: true,
                    invoiceNumber: true,
                    status: true,
                    createdAt: true,
                    customer: {
                      select: { firstName: true, lastName: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { priority: 'desc' }],
    });
    const now = new Date();
    const promotions = rules.map((rule) => {
      const validApplications = rule.applications.filter(
        (application) => application.saleItem.sale.status !== SaleStatus.VOIDED,
      );
      return {
        id: rule.id,
        code: rule.code,
        name: rule.name,
        description: rule.description,
        type: rule.type,
        value: Number(rule.value),
        minimumQuantity: Number(rule.minimumQuantity),
        maximumQuantity:
          rule.maximumQuantity === null ? null : Number(rule.maximumQuantity),
        startsAt: rule.startsAt,
        endsAt: rule.endsAt,
        priority: rule.priority,
        stackable: rule.stackable,
        notifyEmail: rule.notifyEmail,
        notifyWhatsapp: rule.notifyWhatsapp,
        promotionNotifiedAt: rule.promotionNotifiedAt,
        recordStatus: rule.status,
        lifecycleStatus: this.lifecycleStatus(rule, now),
        product: rule.product,
        usageCount: validApplications.length,
        salesCount: new Set(
          validApplications.map((item) => item.saleItem.sale.id),
        ).size,
        unitsSold: validApplications.reduce(
          (sum, item) => sum + Number(item.saleItem.quantity),
          0,
        ),
        totalDiscount: validApplications.reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        ),
        revenue: validApplications.reduce(
          (sum, item) => sum + Number(item.saleItem.lineTotal),
          0,
        ),
      };
    });
    const allApplications = rules
      .flatMap((rule) =>
        rule.applications.map((application) => ({
          id: application.id,
          promotionId: rule.id,
          promotionName: rule.name,
          promotionCode: rule.code,
          amount: Number(application.amount),
          sale: application.saleItem.sale,
        })),
      )
      .filter((item) => item.sale.status !== SaleStatus.VOIDED);
    return {
      stats: {
        activePromotions: promotions.filter(
          (promotion) => promotion.lifecycleStatus === 'ACTIVE',
        ).length,
        upcomingPromotions: promotions.filter(
          (promotion) => promotion.lifecycleStatus === 'UPCOMING',
        ).length,
        totalDiscounts: promotions.reduce(
          (sum, promotion) => sum + promotion.totalDiscount,
          0,
        ),
        revenueFromPromotions: promotions.reduce(
          (sum, promotion) => sum + promotion.revenue,
          0,
        ),
        redemptions: promotions.reduce(
          (sum, promotion) => sum + promotion.usageCount,
          0,
        ),
      },
      promotions,
      recentActivity: allApplications
        .sort(
          (left, right) =>
            right.sale.createdAt.getTime() - left.sale.createdAt.getTime(),
        )
        .slice(0, 10),
    };
  }

  async detail(userId: string, id: string) {
    const dashboard = await this.dashboard(userId);
    const promotion = dashboard.promotions.find((item) => item.id === id);
    if (!promotion) throw new NotFoundException('Promotion not found.');
    const applications = await this.prisma.discountApplication.findMany({
      where: {
        discountRuleId: id,
        saleItem: { sale: { status: { not: SaleStatus.VOIDED } } },
      },
      include: {
        saleItem: {
          select: {
            sale: {
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                createdAt: true,
                customer: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
      orderBy: { saleItem: { sale: { createdAt: 'desc' } } },
      take: 20,
    });
    return {
      ...promotion,
      recentActivity: applications.map((application) => ({
        id: application.id,
        promotionId: promotion.id,
        promotionName: promotion.name,
        promotionCode: promotion.code,
        amount: Number(application.amount),
        sale: application.saleItem.sale,
      })),
    };
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateDiscountRuleDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.org(actor.id);
    this.validate(dto);
    if (
      dto.productId &&
      !(await this.prisma.product.findFirst({
        where: { id: dto.productId, organizationId },
      }))
    )
      throw new NotFoundException('Product not found.');
    const code = await this.promotionCode(organizationId, dto.name, dto.code);
    let value: DiscountRule;
    try {
      value = await this.prisma.discountRule.create({
        data: {
          ...dto,
          code,
          description: dto.description?.trim() || undefined,
          organizationId,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Promotion code already exists.');
      throw error;
    }
    await this.audit.record({
      userId: actor.id,
      action: 'DISCOUNT_RULE_CREATED',
      context,
      metadata: { discountRuleId: value.id },
    });
    return value;
  }
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateDiscountRuleDto,
    context: SecurityRequestContext,
  ) {
    const org = await this.org(actor.id);
    const existing = await this.prisma.discountRule.findFirst({
      where: { id, organizationId: org },
    });
    if (!existing) throw new NotFoundException('Discount rule not found.');
    this.validate(dto);
    const resetNotification =
      dto.startsAt !== undefined ||
      dto.notifyEmail !== undefined ||
      dto.notifyWhatsapp !== undefined;
    let value: DiscountRule;
    try {
      value = await this.prisma.discountRule.update({
        where: { id },
        data: {
          ...dto,
          code: dto.code
            ? await this.promotionCode(
                org,
                dto.name ?? existing.name,
                dto.code,
                id,
              )
            : undefined,
          description:
            dto.description === undefined
              ? undefined
              : dto.description.trim() || null,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
          promotionNotifiedAt: resetNotification ? null : undefined,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Promotion code already exists.');
      throw error;
    }
    await this.audit.record({
      userId: actor.id,
      action: 'DISCOUNT_RULE_UPDATED',
      context,
      metadata: { discountRuleId: id },
    });
    return value;
  }
  private validate(dto: {
    minimumQuantity?: number;
    maximumQuantity?: number;
    startsAt?: string;
    endsAt?: string;
  }) {
    if (
      dto.maximumQuantity !== undefined &&
      dto.minimumQuantity !== undefined &&
      dto.maximumQuantity < dto.minimumQuantity
    )
      throw new BadRequestException(
        'Maximum quantity must be greater than minimum quantity.',
      );
    if (
      dto.startsAt &&
      dto.endsAt &&
      new Date(dto.endsAt) <= new Date(dto.startsAt)
    )
      throw new BadRequestException(
        'Discount end date must be after its start date.',
      );
  }

  private lifecycleStatus(
    rule: {
      status: RecordStatus;
      startsAt: Date | null;
      endsAt: Date | null;
    },
    now: Date,
  ) {
    if (rule.status === RecordStatus.ARCHIVED) return 'ARCHIVED';
    if (rule.status === RecordStatus.INACTIVE) return 'PAUSED';
    if (rule.startsAt && rule.startsAt > now) return 'UPCOMING';
    if (rule.endsAt && rule.endsAt < now) return 'EXPIRED';
    return 'ACTIVE';
  }

  private async promotionCode(
    organizationId: string,
    name: string,
    requested?: string,
    excludeId?: string,
  ) {
    const base =
      (requested || name)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'PROMO';
    const exists = await this.prisma.discountRule.findFirst({
      where: {
        organizationId,
        code: base,
        id: excludeId ? { not: excludeId } : undefined,
      },
      select: { id: true },
    });
    return exists
      ? `${base.slice(0, 25)}-${randomUUID().slice(0, 6).toUpperCase()}`
      : base;
  }
}
