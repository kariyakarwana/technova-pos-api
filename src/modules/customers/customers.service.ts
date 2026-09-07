import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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
      status: q.status,
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
        include: { loyaltyAccount: true, storeCreditAccount: true },
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
        storeCreditAccount: {
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
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId: actor.id },
      select: {
        organizationId: true,
        organization: { select: { name: true } },
      },
    });
    if (!membership) throw new NotFoundException('Organization not found.');

    let value: Awaited<
      ReturnType<typeof this.createWithGeneratedNumber>
    > | null = null;
    for (let attempt = 0; attempt < 5 && !value; attempt += 1) {
      try {
        value = await this.createWithGeneratedNumber(
          membership.organizationId,
          dto,
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          continue;
        throw error;
      }
    }
    if (!value)
      throw new ConflictException(
        'Unable to generate a unique customer number. Please try again.',
      );

    await this.audit.record({
      userId: actor.id,
      action: 'CUSTOMER_CREATED',
      context,
      metadata: { customerId: value.id, customerNumber: value.customerNumber },
    });

    let queuedChannels: string[] = [];
    try {
      const welcome = await this.notifications.queueCustomerWelcome({
        organizationId: membership.organizationId,
        companyName: membership.organization.name,
        customerId: value.id,
        customerNumber: value.customerNumber,
        firstName: value.firstName,
        lastName: value.lastName,
        phone: value.phone,
        email: value.email,
      });
      queuedChannels = welcome.queuedChannels;
    } catch (error) {
      this.logger.error(
        `Customer ${value.id} was created, but welcome notifications could not be queued.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return {
      ...value,
      welcomeNotifications: {
        emailQueued: queuedChannels.includes('EMAIL'),
        whatsappQueued: queuedChannels.includes('WHATSAPP'),
      },
    };
  }

  private async createWithGeneratedNumber(
    organizationId: string,
    dto: CreateCustomerDto,
  ) {
    const customerNumber = await this.nextCustomerNumber(organizationId);
    return this.prisma.customer.create({
      data: {
        ...dto,
        customerNumber,
        organizationId,
        address: dto.address,
        loyaltyAccount: { create: {} },
      },
      include: { loyaltyAccount: true, storeCreditAccount: true },
    });
  }

  private async nextCustomerNumber(organizationId: string) {
    const recent = await this.prisma.customer.findMany({
      where: { organizationId, customerNumber: { startsWith: 'CUS-' } },
      select: { customerNumber: true },
      orderBy: { customerNumber: 'desc' },
      take: 100,
    });
    const highest = recent.reduce((maximum, customer) => {
      const match = /^CUS-(\d+)$/.exec(customer.customerNumber);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
    return `CUS-${String(highest + 1).padStart(6, '0')}`;
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
