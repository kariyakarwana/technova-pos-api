import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { DEFAULT_ADDON_PACKS } from './addon-defaults';
import { QuotaService } from './quota.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  async ensureDefaultAddonPacks() {
    const count = await this.prisma.addonPack.count();
    if (count === 0) {
      for (const pack of DEFAULT_ADDON_PACKS) {
        await this.prisma.addonPack.upsert({
          where: { code: pack.code },
          update: {},
          create: {
            code: pack.code,
            name: pack.name,
            description: pack.description,
            quotaTarget: pack.quotaTarget,
            unitsPerPack: pack.unitsPerPack,
            priceUsd: new Prisma.Decimal(pack.priceUsd),
            billingCycle: pack.billingCycle,
            features: pack.features,
            isActive: true,
          },
        });
      }
    }
  }

  /**
   * Returns list of all active commercial plans.
   */
  async getPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceUsd: 'asc' },
    });
  }

  /**
   * Returns list of active add-on packs from the catalog.
   */
  async getAddonCatalog() {
    await this.ensureDefaultAddonPacks();
    return this.prisma.addonPack.findMany({
      where: { isActive: true },
      orderBy: { priceUsd: 'asc' },
    });
  }

  /**
   * Returns subscription details for a tenant.
   */
  async getSubscriptionDetails(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: {
        plan: true,
        addons: {
          where: { isActive: true },
          include: { addonPack: true },
        },
        invoices: {
          orderBy: { issuedDate: 'desc' },
          take: 12,
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found for this organization.');
    }

    const [usageOverview, availablePlans, availableAddonPacks, requests] = await Promise.all([
      this.quota.getUsageOverview(organizationId),
      this.getPlans(),
      this.getAddonCatalog(),
      this.prisma.subscriptionRequest.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      subscription,
      usageOverview,
      availablePlans,
      availableAddonPacks,
      requests,
    };
  }

  /**
   * Returns invoices for the tenant.
   */
  async getInvoices(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      select: { id: true },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found.');
    }

    return this.prisma.subscriptionInvoice.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { issuedDate: 'desc' },
    });
  }

  /**
   * Generates a monthly subscription invoice.
   */
  async generateMonthlyInvoice(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found.');
    }

    const subtotal = new Prisma.Decimal(subscription.plan.priceUsd);
    const vatRate = new Prisma.Decimal(subscription.plan.vatRate);
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.add(vatAmount).toDecimalPlaces(2);

    const timestamp = Date.now().toString(36).toUpperCase();
    const invoiceNumber = `INV-${subscription.plan.code}-${timestamp}`;
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return this.prisma.subscriptionInvoice.create({
      data: {
        subscriptionId,
        invoiceNumber,
        subtotalUsd: subtotal,
        vatAmountUsd: vatAmount,
        totalAmountUsd: totalAmount,
        status: 'PENDING',
        dueDate,
      },
    });
  }

  /**
   * Submits a Plan Change / Upgrade request for Platform Admin approval.
   */
  async requestPlanChange(
    organizationId: string,
    userId: string,
    dto: { targetPlanCode: string; notes?: string; paymentRef?: string },
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found.');
    }

    const targetCode = dto.targetPlanCode.trim().toUpperCase();
    const targetPlan = await this.prisma.plan.findUnique({
      where: { code: targetCode },
    });

    if (!targetPlan || !targetPlan.isActive) {
      throw new NotFoundException(`Plan '${dto.targetPlanCode}' not found or inactive.`);
    }

    if (subscription.plan.code.toUpperCase() === targetCode) {
      throw new BadRequestException(`Your organization is already on ${targetPlan.name}.`);
    }

    const existingPending = await this.prisma.subscriptionRequest.findFirst({
      where: {
        organizationId,
        type: 'PLAN_CHANGE',
        status: 'PENDING',
      },
    });

    if (existingPending) {
      throw new ConflictException(
        `A pending plan change request (${existingPending.targetPlanCode}) is already awaiting Platform Admin review.`,
      );
    }

    const request = await this.prisma.subscriptionRequest.create({
      data: {
        organizationId,
        subscriptionId: subscription.id,
        requestedById: userId,
        type: 'PLAN_CHANGE',
        status: 'PENDING',
        targetPlanCode: targetPlan.code,
        quantity: 1,
        notes: dto.notes?.trim() || null,
        paymentRef: dto.paymentRef?.trim() || null,
      },
    });

    return {
      message: `Plan change request to '${targetPlan.name}' submitted for Platform Admin approval.`,
      request,
    };
  }

  /**
   * Submits an Add-on Pack request for Platform Admin approval.
   */
  async requestAddon(
    organizationId: string,
    type: string,
    quantity = 1,
    options?: { userId?: string; notes?: string; paymentRef?: string },
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found.');
    }

    await this.ensureDefaultAddonPacks();
    const packCode = type.trim().toUpperCase();
    const pack = await this.prisma.addonPack.findUnique({
      where: { code: packCode },
    });

    if (!pack || !pack.isActive) {
      throw new BadRequestException(`Add-on pack '${type}' is invalid or inactive.`);
    }

    const qty = Math.max(1, Math.min(25, Number(quantity) || 1));

    const request = await this.prisma.subscriptionRequest.create({
      data: {
        organizationId,
        subscriptionId: subscription.id,
        requestedById: options?.userId ?? null,
        type: 'ADDON_PACK',
        status: 'PENDING',
        addonCode: pack.code,
        quantity: qty,
        notes: options?.notes?.trim() || null,
        paymentRef: options?.paymentRef?.trim() || null,
      },
    });

    return {
      message: `Add-on request (${qty}x ${pack.name}) submitted for Platform Admin approval.`,
      request,
    };
  }

  /**
   * Settle a pending invoice using the Online Payment Gateway.
   */
  async payInvoiceOnline(
    organizationId: string,
    invoiceId: string,
    dto: {
      paymentMethod?: string;
      cardBrand?: string;
      cardLast4?: string;
      cardHolderName?: string;
      gatewayRef?: string;
    },
  ) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        subscription: {
          include: {
            organization: true,
            plan: true,
          },
        },
      },
    });

    if (!invoice || invoice.subscription.organizationId !== organizationId) {
      throw new NotFoundException('Subscription invoice not found.');
    }

    if (invoice.status === 'PAID') {
      throw new BadRequestException('This invoice has already been paid.');
    }

    const resolvedMethod = dto.paymentMethod || 'ONLINE_GATEWAY';
    const txnRef =
      dto.gatewayRef?.trim() ||
      `TXN-ONL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const paidNow = new Date();
    const updatedInvoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.subscriptionInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'PAID',
          paidAt: paidNow,
          paymentMethod: resolvedMethod,
          paymentRef: txnRef,
          notes: dto.cardLast4
            ? `Paid via Online Payment Gateway (${dto.cardBrand || 'Card'} ending in ${dto.cardLast4})`
            : `Paid via Online Payment Gateway (${resolvedMethod})`,
        },
      });

      // Keep subscription active
      await tx.subscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          status: 'ACTIVE',
        },
      });

      return inv;
    });

    return {
      message: `Invoice ${invoice.invoiceNumber} successfully paid via Online Gateway.`,
      transactionReference: txnRef,
      invoice: updatedInvoice,
    };
  }
}
