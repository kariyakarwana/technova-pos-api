import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    const value = await this.prisma.discountRule.create({
      data: {
        ...dto,
        organizationId,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      },
    });
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
    if (
      !(await this.prisma.discountRule.findFirst({
        where: { id, organizationId: org },
      }))
    )
      throw new NotFoundException('Discount rule not found.');
    this.validate(dto);
    const value = await this.prisma.discountRule.update({
      where: { id },
      data: {
        ...dto,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      },
    });
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
}
