import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  CustomerNotificationQueryDto,
  CustomerProductQueryDto,
} from './dto/customer-app.dto';

@Injectable()
export class CustomerAppService {
  constructor(private readonly prisma: PrismaService) {}

  private async customer(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        id: true,
        organizationId: true,
        customerNumber: true,
        status: true,
      },
    });
    if (!customer)
      throw new ForbiddenException('A customer account is required.');
    if (customer.status !== RecordStatus.ACTIVE)
      throw new ForbiddenException('This customer account is not active.');
    return customer;
  }

  async profile(userId: string) {
    await this.customer(userId);
    const profile = await this.prisma.customer.findUnique({
      where: { userId },
      include: {
        loyaltyAccount: true,
        storeCreditAccount: true,
        organization: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            currencyCode: true,
            branding: {
              select: {
                logoUrl: true,
                primaryColor: true,
                secondaryColor: true,
              },
            },
          },
        },
        user: {
          select: {
            email: true,
            phone: true,
            mustChangePassword: true,
            lastLoginAt: true,
          },
        },
      },
    });
    if (!profile) throw new NotFoundException('Customer profile not found.');
    return profile;
  }

  async home(userId: string) {
    const customer = await this.customer(userId);
    const now = new Date();
    const [profile, activeCredits, activePromotions, unreadNotifications] =
      await Promise.all([
        this.prisma.customer.findUnique({
          where: { id: customer.id },
          select: {
            customerNumber: true,
            firstName: true,
            lastName: true,
            loyaltyAccount: { select: { points: true, tier: true } },
            storeCreditAccount: { select: { balance: true } },
          },
        }),
        this.prisma.creditAgreement.count({
          where: { customerId: customer.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
        }),
        this.prisma.discountRule.count({
          where: {
            organizationId: customer.organizationId,
            status: RecordStatus.ACTIVE,
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
            AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
          },
        }),
        this.prisma.appNotification.count({
          where: { recipientUserId: userId, readAt: null },
        }),
      ]);
    return {
      customer: profile,
      summary: {
        loyaltyPoints: profile?.loyaltyAccount?.points ?? 0,
        loyaltyTier: profile?.loyaltyAccount?.tier ?? null,
        storeCreditBalance: profile?.storeCreditAccount?.balance ?? 0,
        activeCreditPurchases: activeCredits,
        activePromotions,
        unreadNotifications,
      },
    };
  }

  async loyalty(userId: string, query: CustomerNotificationQueryDto) {
    const customer = await this.customer(userId);
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId: customer.id },
    });
    if (!account)
      return { points: 0, tier: null, ...paginate([], 0, query) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.loyaltyTransaction.findMany({
        where: { loyaltyAccountId: account.id },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loyaltyTransaction.count({
        where: { loyaltyAccountId: account.id },
      }),
    ]);
    return { points: account.points, tier: account.tier, ...paginate(data, total, query) };
  }

  async products(userId: string, query: CustomerProductQueryDto) {
    const customer = await this.customer(userId);
    const where: Prisma.ProductWhereInput = {
      organizationId: customer.organizationId,
      status: RecordStatus.ACTIVE,
      categoryId: query.categoryId,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: 'insensitive' } },
            { sku: { contains: query.search, mode: 'insensitive' } },
            { barcode: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          description: true,
          sellingPrice: true,
          taxRate: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: {
            select: { id: true, url: true, altText: true, position: true },
            orderBy: { position: 'asc' },
          },
          videos: {
            select: { id: true, url: true, originalName: true },
            orderBy: { createdAt: 'asc' },
          },
          stockLevels: {
            select: {
              quantityOnHand: true,
              quantityReserved: true,
              branch: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(
      data.map(({ stockLevels, ...product }) => ({
        ...product,
        availableQuantity: stockLevels.reduce(
          (totalAvailable, level) =>
            totalAvailable +
            Math.max(
              0,
              Number(level.quantityOnHand) - Number(level.quantityReserved),
            ),
          0,
        ),
        availabilityByBranch: stockLevels.map((level) => ({
          branch: level.branch,
          inStock:
            Number(level.quantityOnHand) - Number(level.quantityReserved) > 0,
        })),
      })),
      total,
      query,
    );
  }

  async categories(userId: string) {
    const customer = await this.customer(userId);
    return this.prisma.category.findMany({
      where: {
        organizationId: customer.organizationId,
        status: RecordStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
        description: true,
        parentId: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async creditPurchases(userId: string, query: CustomerNotificationQueryDto) {
    const customer = await this.customer(userId);
    const where = { customerId: customer.id };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.creditAgreement.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          principal: true,
          outstandingBalance: true,
          dueDate: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          sale: {
            select: {
              id: true,
              invoiceNumber: true,
              subtotal: true,
              discountTotal: true,
              taxTotal: true,
              total: true,
              paidTotal: true,
              balanceDue: true,
              completedAt: true,
              branch: { select: { id: true, name: true, code: true } },
              items: {
                select: {
                  id: true,
                  quantity: true,
                  unitPrice: true,
                  discountTotal: true,
                  taxTotal: true,
                  lineTotal: true,
                  product: { select: { id: true, sku: true, name: true } },
                },
              },
            },
          },
          installments: {
            orderBy: { installmentNumber: 'asc' },
            select: {
              id: true,
              installmentNumber: true,
              amountDue: true,
              amountPaid: true,
              dueDate: true,
              status: true,
              paidAt: true,
            },
          },
        },
      }),
      this.prisma.creditAgreement.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async promotions(userId: string, query: CustomerNotificationQueryDto) {
    const customer = await this.customer(userId);
    const now = new Date();
    const where: Prisma.DiscountRuleWhereInput = {
      organizationId: customer.organizationId,
      status: RecordStatus.ACTIVE,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.discountRule.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: [{ priority: 'desc' }, { startsAt: 'desc' }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          type: true,
          value: true,
          minimumQuantity: true,
          maximumQuantity: true,
          startsAt: true,
          endsAt: true,
          stackable: true,
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              sellingPrice: true,
              images: {
                take: 1,
                orderBy: { position: 'asc' },
                select: { url: true, altText: true },
              },
            },
          },
        },
      }),
      this.prisma.discountRule.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async notifications(userId: string, query: CustomerNotificationQueryDto) {
    await this.customer(userId);
    const where: Prisma.AppNotificationWhereInput = {
      recipientUserId: userId,
      readAt: query.unread === 'true' ? null : undefined,
    };
    const [data, total, unread] = await this.prisma.$transaction([
      this.prisma.appNotification.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.appNotification.count({ where }),
      this.prisma.appNotification.count({
        where: { recipientUserId: userId, readAt: null },
      }),
    ]);
    return { ...paginate(data, total, query), unread };
  }

  async readNotification(userId: string, id: string) {
    await this.customer(userId);
    const result = await this.prisma.appNotification.updateMany({
      where: { id, recipientUserId: userId },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Notification not found.');
    return { read: true };
  }

  async readAllNotifications(userId: string) {
    await this.customer(userId);
    const result = await this.prisma.appNotification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: result.count };
  }
}
