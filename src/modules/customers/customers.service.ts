import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordStatus, UserStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import { hashPassword } from '../../common/security/password';
import { normalizePhone } from '../../common/security/phone';
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
        include: {
          loyaltyAccount: true,
          storeCreditAccount: true,
          user: { select: { status: true, lastLoginAt: true } },
        },
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
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            status: true,
            mustChangePassword: true,
            lastLoginAt: true,
          },
        },
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

    const email = dto.email.trim().toLowerCase();
    const phone = normalizePhone(dto.phone);
    const existingAccount = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true, phone: true },
    });
    if (existingAccount)
      throw new ConflictException(
        existingAccount.email === email
          ? 'An account already exists for this email address.'
          : 'An account already exists for this phone number.',
      );

    const temporaryPassword = this.temporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    let value: Awaited<
      ReturnType<typeof this.createWithGeneratedNumber>
    > | null = null;
    for (let attempt = 0; attempt < 5 && !value; attempt += 1) {
      try {
        value = await this.createWithGeneratedNumber(
          membership.organizationId,
          { ...dto, email, phone },
          passwordHash,
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const rawTarget = error.meta?.target;
          const target = Array.isArray(rawTarget)
            ? rawTarget.filter((item): item is string => typeof item === 'string').join(',')
            : typeof rawTarget === 'string'
              ? rawTarget
              : '';
          if (target.includes('email'))
            throw new ConflictException(
              'An account already exists for this email address.',
            );
          if (target.includes('phone'))
            throw new ConflictException(
              'An account already exists for this phone number.',
            );
          continue;
        }
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
      metadata: {
        customerId: value.id,
        customerNumber: value.customerNumber,
        customerUserId: value.userId,
        credentialsCreated: true,
      },
    });

    let queuedChannels: string[] = [];
    try {
      const welcome = await this.notifications.queueCustomerWelcome({
        organizationId: membership.organizationId,
        companyName: membership.organization.name,
        customerId: value.id,
        userId: value.userId!,
        customerNumber: value.customerNumber,
        firstName: value.firstName,
        lastName: value.lastName,
        phone,
        email,
        temporaryPassword,
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
      credentialsCreated: true,
      temporaryPasswordSent:
        queuedChannels.includes('EMAIL') &&
        queuedChannels.includes('WHATSAPP'),
      welcomeNotifications: {
        emailQueued: queuedChannels.includes('EMAIL'),
        whatsappQueued: queuedChannels.includes('WHATSAPP'),
      },
    };
  }

  private async createWithGeneratedNumber(
    organizationId: string,
    dto: CreateCustomerDto,
    passwordHash: string,
  ) {
    const customerNumber = await this.nextCustomerNumber(organizationId);
    return this.prisma.$transaction(async (transaction) => {
      const permission = await transaction.permission.upsert({
        where: { key: 'customer-app:access' },
        update: { description: 'Access the customer mobile application' },
        create: {
          key: 'customer-app:access',
          description: 'Access the customer mobile application',
        },
      });
      const role = await transaction.role.upsert({
        where: { name: 'CUSTOMER' },
        update: {
          description: 'Customer mobile application user',
          isSystem: true,
        },
        create: {
          name: 'CUSTOMER',
          description: 'Customer mobile application user',
          isSystem: true,
        },
      });
      await transaction.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      const user = await transaction.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          phone: normalizePhone(dto.phone),
          name: `${dto.firstName} ${dto.lastName ?? ''}`.trim(),
          passwordHash,
          emailVerified: new Date(),
          status: UserStatus.ACTIVE,
          mustChangePassword: true,
          organizationMemberships: { create: { organizationId } },
          roles: { create: { roleId: role.id } },
        },
      });
      return transaction.customer.create({
        data: {
          ...dto,
          email: dto.email.trim().toLowerCase(),
          phone: normalizePhone(dto.phone),
          customerNumber,
          organizationId,
          userId: user.id,
          address: dto.address,
          loyaltyAccount: { create: {} },
        },
        include: {
          loyaltyAccount: true,
          storeCreditAccount: true,
          user: { select: { status: true, lastLoginAt: true } },
        },
      });
    });
  }

  private temporaryPassword() {
    return `${randomBytes(9).toString('base64url')}Aa1!`;
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
    const current = await this.detail(actor.id, id);
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone ? normalizePhone(dto.phone) : undefined;
    const value = await this.prisma.$transaction(async (transaction) => {
      const customer = await transaction.customer.update({
        where: { id },
        data: { ...dto, email, phone, address: dto.address },
        include: {
          loyaltyAccount: true,
          storeCreditAccount: true,
          user: { select: { status: true, lastLoginAt: true } },
        },
      });
      if (current.userId) {
        const identityChanged = email !== undefined || phone !== undefined;
        await transaction.user.update({
          where: { id: current.userId },
          data: {
            email,
            phone,
            name:
              dto.firstName !== undefined || dto.lastName !== undefined
                ? `${dto.firstName ?? current.firstName} ${dto.lastName ?? current.lastName ?? ''}`.trim()
                : undefined,
            status:
              dto.status === undefined
                ? undefined
                : dto.status === RecordStatus.ACTIVE
                  ? UserStatus.ACTIVE
                  : UserStatus.INACTIVE,
            sessionVersion:
              identityChanged || dto.status !== undefined
                ? { increment: 1 }
                : undefined,
          },
        });
      }
      return customer;
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
