import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
@Injectable()
export class CustomersService {
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
  async list(userId: string, q: CustomerQueryDto) {
    const organizationId = await this.org(userId);
    const where: Prisma.CustomerWhereInput = {
      organizationId,
      OR: q.search
        ? [
            { customerNumber: { contains: q.search, mode: 'insensitive' } },
            { firstName: { contains: q.search, mode: 'insensitive' } },
            { lastName: { contains: q.search, mode: 'insensitive' } },
            { phone: { contains: q.search } },
          ]
        : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        include: { loyaltyAccount: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginate(data, total, q);
  }
  async detail(userId: string, id: string) {
    const organizationId = await this.org(userId);
    const value = await this.prisma.customer.findFirst({
      where: { id, organizationId },
      include: {
        loyaltyAccount: {
          include: {
            transactions: { take: 20, orderBy: { createdAt: 'desc' } },
          },
        },
        creditAgreements: { orderBy: { createdAt: 'desc' }, take: 20 },
        warranties: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!value) throw new NotFoundException('Customer not found.');
    return value;
  }
  async create(
    actor: AuthenticatedUser,
    dto: CreateCustomerDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.org(actor.id);
    try {
      const value = await this.prisma.customer.create({
        data: {
          ...dto,
          customerNumber: dto.customerNumber.trim().toUpperCase(),
          organizationId,
          address: dto.address,
          loyaltyAccount: { create: {} },
        },
        include: { loyaltyAccount: true },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'CUSTOMER_CREATED',
        context,
        metadata: { customerId: value.id },
      });
      return value;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('Customer number already exists.');
      throw e;
    }
  }
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateCustomerDto,
    context: SecurityRequestContext,
  ) {
    await this.detail(actor.id, id);
    const value = await this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        address: dto.address,
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'CUSTOMER_UPDATED',
      context,
      metadata: { customerId: id },
    });
    return value;
  }
}
