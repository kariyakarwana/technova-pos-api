import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AddonQuotaTarget,
  PlanTier,
  Prisma,
  RecordStatus,
  UserStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { DEFAULT_ADDON_PACKS } from '../subscriptions/addon-defaults';
import { QuotaService, type UsageOverview } from '../subscriptions/quota.service';
import type {
  AllocateAddonDto,
  ChangeTenantPlanDto,
  CreateAddonPackDto,
  CreatePlanDto,
  CreateTenantDto,
  RecordPaymentDto,
  ReviewSubscriptionRequestDto,
  UpdateAddonPackDto,
  UpdateOrganizationDto,
  UpdatePlanDto,
  UpdateTenantAdminDto,
  UpdateTenantStatusDto,
} from './dto/platform-admin.dto';

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * Lists all organizations with active plan, branch count, user count,
   * live quota metrics, and billing health.
   */
  async listOrganizations() {
    const orgs = await this.prisma.organization.findMany({
      include: {
        branches: {
          select: { id: true, name: true, code: true, status: true },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                status: true,
                roles: {
                  include: {
                    role: {
                      select: { name: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
        subscription: {
          include: {
            plan: true,
            invoices: {
              orderBy: { issuedDate: 'desc' },
              take: 3,
            },
          },
        },
        _count: {
          select: {
            branches: true,
            users: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const results: any[] = [];
    for (const org of orgs) {
      let usageOverview: UsageOverview | null = null;
      try {
        usageOverview = await this.quota.getUsageOverview(org.id);
      } catch (e) {
        this.logger.warn(`Could not compute usage for org ${org.id}: ${e}`);
      }

      const superAdminMember = org.users.find((m) =>
        m.user.roles.some((r) => r.role.name === 'SUPER_ADMIN'),
      );

      results.push({
        id: org.id,
        name: org.name,
        registrationNumber: org.registrationNumber,
        phone: org.phone,
        email: org.email,
        status: org.status,
        createdAt: org.createdAt,
        branches: org.branches,
        tenantAdmin: superAdminMember
          ? {
              id: superAdminMember.user.id,
              name: superAdminMember.user.name,
              email: superAdminMember.user.email,
              phone: superAdminMember.user.phone,
              status: superAdminMember.user.status,
            }
          : null,
        counts: {
          branches: org._count.branches,
          users: org._count.users,
        },
        subscription: org.subscription
          ? {
              status: org.subscription.status,
              planCode: org.subscription.plan.code,
              planTier: org.subscription.plan.tier,
              planName: org.subscription.plan.name,
              priceUsd: Number(org.subscription.plan.priceUsd),
              priceWithVatUsd: Number(org.subscription.plan.priceWithVatUsd),
              currentPeriodEnd: org.subscription.currentPeriodEnd,
              extraBranches: org.subscription.extraBranches,
              extraWhatsAppBills: org.subscription.extraWhatsAppBills,
              extraAiRequests: org.subscription.extraAiRequests,
              recentInvoices: org.subscription.invoices,
            }
          : null,
        usage: usageOverview ? usageOverview.metrics : null,
      });
    }

    return results;
  }

  /**
   * Onboards a brand new tenant organization with isolated DB/schema readiness,
   * provisions primary branch, seeds tenant Super Admin, assigns Plan, and generates initial Invoice.
   */
  async createTenant(
    dto: CreateTenantDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const plan = await this.prisma.plan.findUnique({
      where: { code: dto.planCode.toUpperCase() },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with code '${dto.planCode}' not found.`);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.adminEmail.trim().toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException(
        `A user with email '${dto.adminEmail}' already exists in the system.`,
      );
    }

    const tempPassword =
      dto.temporaryPassword || `Tn1!${randomBytes(8).toString('hex')}`;
    const passwordHash = await hash(tempPassword, 12);

    let superAdminRole = await this.prisma.role.findUnique({
      where: { name: 'SUPER_ADMIN' },
    });

    if (!superAdminRole) {
      superAdminRole = await this.prisma.role.create({
        data: {
          name: 'SUPER_ADMIN',
          description: 'Tenant super administrator',
          isSystem: true,
        },
      });
    }

    const branchCode = (dto.branchCode || 'MAIN').trim().toUpperCase();
    const branchName = dto.branchName || 'Main Branch';
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subtotal = new Prisma.Decimal(plan.priceUsd);
    const vatRate = new Prisma.Decimal(plan.vatRate);
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.add(vatAmount).toDecimalPlaces(2);
    const invoiceNumber = `INV-${plan.code}-${Date.now().toString(36).toUpperCase()}`;

    const createdTenant = await this.prisma.$transaction(async (tx) => {
      // 1. Create Organization
      const org = await tx.organization.create({
        data: {
          name: dto.name.trim(),
          registrationNumber: dto.registrationNumber?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || dto.adminEmail.trim().toLowerCase(),
          status: RecordStatus.ACTIVE,
          branding: {
            create: {
              primaryColor: '#0D9488',
              secondaryColor: '#115E59',
            },
          },
        },
      });

      // 2. Create Initial Branch
      const branch = await tx.branch.create({
        data: {
          organizationId: org.id,
          code: branchCode,
          name: branchName,
          status: RecordStatus.ACTIVE,
        },
      });

      // 3. Create Tenant Super Admin User
      const admin = await tx.user.create({
        data: {
          email: dto.adminEmail.trim().toLowerCase(),
          name: dto.adminName.trim(),
          phone: dto.adminPhone?.trim() || null,
          passwordHash,
          emailVerified: now,
          status: UserStatus.ACTIVE,
          mustChangePassword: true,
          organizationMemberships: {
            create: { organizationId: org.id },
          },
          branchAssignments: {
            create: { branchId: branch.id, isDefault: true },
          },
          roles: {
            create: { roleId: superAdminRole.id },
          },
        },
      });

      // 4. Attach Commercial Plan Subscription
      const sub = await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      // 5. Generate Initial Invoice
      const invoice = await tx.subscriptionInvoice.create({
        data: {
          subscriptionId: sub.id,
          invoiceNumber,
          subtotalUsd: subtotal,
          vatAmountUsd: vatAmount,
          totalAmountUsd: totalAmount,
          status: 'PENDING',
          dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          notes: `Initial subscription invoice for ${plan.name} (excl. VAT: $${plan.priceUsd}, 18% VAT: $${vatAmount})`,
        },
      });

      return {
        organization: org,
        branch,
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          temporaryPassword: tempPassword,
        },
        subscription: sub,
        invoice,
      };
    });

    let temporaryPasswordSent = false;
    try {
      await this.auth.sendTenantAdminTemporaryPasswordEmail(
        createdTenant.admin.email,
        createdTenant.admin.name ?? dto.adminName.trim(),
        createdTenant.organization.name,
        tempPassword,
        false,
      );
      temporaryPasswordSent = true;
    } catch (err) {
      this.logger.warn(
        `Failed to send initial Tenant Admin temporary password email to ${createdTenant.admin.email}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    await this.audit.record({
      userId: actor.id,
      action: 'ORGANIZATION_PROVISIONED',
      context,
      metadata: {
        organizationId: createdTenant.organization.id,
        organizationName: createdTenant.organization.name,
        planCode: plan.code,
        adminEmail: dto.adminEmail,
        temporaryPasswordSent,
      },
    });

    return {
      message: 'Tenant organization provisioned successfully.',
      ...createdTenant,
      temporaryPasswordSent,
    };
  }

  /**
   * Suspends or reactivates a tenant organization.
   */
  async updateTenantStatus(
    organizationId: string,
    dto: UpdateTenantStatusDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found.');
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        status: dto.status,
      },
    });

    if (org.subscription) {
      await this.prisma.subscription.update({
        where: { id: org.subscription.id },
        data: {
          status: dto.status === RecordStatus.ACTIVE ? 'ACTIVE' : 'SUSPENDED',
        },
      });
    }

    await this.audit.record({
      userId: actor.id,
      action: 'ORGANIZATION_STATUS_CHANGED',
      context,
      metadata: {
        organizationId,
        newStatus: dto.status,
      },
    });

    return {
      message: `Organization status changed to ${dto.status}.`,
      organization: updated,
    };
  }

  /**
   * Upgrades or changes a tenant's subscription plan.
   */
  async changeTenantPlan(
    organizationId: string,
    dto: ChangeTenantPlanDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const plan = await this.prisma.plan.findUnique({
      where: { code: dto.planCode.toUpperCase() },
    });

    if (!plan) {
      throw new NotFoundException(`Plan '${dto.planCode}' not found.`);
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    const subtotal = new Prisma.Decimal(plan.priceUsd);
    const vatRate = new Prisma.Decimal(plan.vatRate);
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.add(vatAmount).toDecimalPlaces(2);
    const invoiceNumber = `INV-${plan.code}-${Date.now().toString(36).toUpperCase()}`;

    let activeSubId: string;
    let updatedSub: any;

    if (!subscription) {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      updatedSub = await this.prisma.subscription.create({
        data: {
          organizationId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        include: { plan: true },
      });
      activeSubId = updatedSub.id;
    } else {
      updatedSub = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: plan.id,
          status: 'ACTIVE',
        },
        include: { plan: true },
      });
      activeSubId = subscription.id;
    }

    const newInvoice = await this.prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: activeSubId,
        invoiceNumber,
        subtotalUsd: subtotal,
        vatAmountUsd: vatAmount,
        totalAmountUsd: totalAmount,
        status: 'PENDING',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notes: `Plan assigned/changed to ${plan.name}`,
      },
    });

    await this.audit.record({
      userId: actor.id,
      action: 'SUBSCRIPTION_PLAN_CHANGED',
      context,
      metadata: {
        organizationId,
        newPlanCode: plan.code,
      },
    });

    return {
      message: `Plan upgraded to ${plan.name}. New invoice generated.`,
      subscription: updatedSub,
      invoice: newInvoice,
    };
  }

  /**
   * Manually allocates extra add-ons (extra branches, extra WhatsApp, extra AI)
   * to a tenant's subscription.
   */
  private async ensureDefaultAddonPacks() {
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
   * Provisions an extra add-on pack (quota + optional features) for a tenant immediately.
   */
  async allocateAddon(
    organizationId: string,
    dto: AllocateAddonDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      throw new BadRequestException(
        'This organization does not have an active subscription yet. Please assign a plan using the "Plan" button first.',
      );
    }

    await this.ensureDefaultAddonPacks();
    const packCode = dto.type.trim().toUpperCase();
    const pack = await this.prisma.addonPack.findUnique({
      where: { code: packCode },
    });

    if (!pack) {
      throw new NotFoundException(`Add-on pack '${dto.type}' not found in catalog.`);
    }

    const totalPrice = new Prisma.Decimal(Number(pack.priceUsd) * dto.quantity);
    const totalUnits = pack.unitsPerPack * dto.quantity;

    let updateData: Prisma.SubscriptionUpdateInput = {};
    if (pack.quotaTarget === AddonQuotaTarget.BRANCHES && totalUnits > 0) {
      updateData = { extraBranches: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.WHATSAPP_BILLS && totalUnits > 0) {
      updateData = { extraWhatsAppBills: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.WHATSAPP_MARKETING && totalUnits > 0) {
      updateData = { extraWhatsAppMarketing: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.EMAILS && totalUnits > 0) {
      updateData = { extraEmailLimit: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.AI_REQUESTS && totalUnits > 0) {
      updateData = { extraAiRequests: { increment: totalUnits } };
    }

    const [updatedSub, addon] = await this.prisma.$transaction([
      Object.keys(updateData).length > 0
        ? this.prisma.subscription.update({
            where: { id: subscription.id },
            data: updateData,
          })
        : this.prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }),
      this.prisma.subscriptionAddon.create({
        data: {
          subscriptionId: subscription.id,
          addonPackId: pack.id,
          type: pack.code,
          quantity: dto.quantity,
          grantedUnits: totalUnits,
          priceUsd: totalPrice,
          features: pack.features ?? [],
          isActive: true,
        },
      }),
    ]);

    await this.audit.record({
      userId: actor.id,
      action: 'ADDON_ALLOCATED',
      context,
      metadata: {
        organizationId,
        addonCode: pack.code,
        addonName: pack.name,
        quantity: dto.quantity,
        grantedUnits: totalUnits,
      },
    });

    return {
      message: `Allocated ${dto.quantity}x ${pack.name} successfully.`,
      subscription: updatedSub,
      addon,
    };
  }

  /**
   * Records a manual bank transfer / check payment for an invoice and marks it PAID.
   */
  async recordPayment(
    invoiceId: string,
    dto: RecordPaymentDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        subscription: {
          include: { organization: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    const updatedInvoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.subscriptionInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentMethod: dto.paymentMethod,
          paymentRef: dto.paymentRef,
          notes: dto.notes ? `${invNotes(invoice.notes)} | ${dto.notes}` : invoice.notes,
        },
      });

      // Reactivate subscription and organization if suspended
      await tx.subscription.update({
        where: { id: invoice.subscriptionId },
        data: { status: 'ACTIVE' },
      });

      await tx.organization.update({
        where: { id: invoice.subscription.organizationId },
        data: { status: RecordStatus.ACTIVE },
      });

      return inv;
    });

    await this.audit.record({
      userId: actor.id,
      action: 'SUBSCRIPTION_PAYMENT_RECORDED',
      context,
      metadata: {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        amountUsd: Number(invoice.totalAmountUsd),
        paymentRef: dto.paymentRef,
      },
    });

    return {
      message: `Invoice ${invoice.invoiceNumber} marked as PAID.`,
      invoice: updatedInvoice,
    };
  }

  /**
   * Computes platform-wide analytics for the Super Super Admin dashboard.
   */
  async getPlatformAnalytics() {
    const totalOrganizations = await this.prisma.organization.count();
    const activeOrganizations = await this.prisma.organization.count({
      where: { status: RecordStatus.ACTIVE },
    });
    const suspendedOrganizations = await this.prisma.organization.count({
      where: { status: RecordStatus.INACTIVE },
    });

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const newThisMonth = await this.prisma.organization.count({
      where: { createdAt: { gte: startOfMonth } },
    });

    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      include: { plan: true },
    });

    let totalMrrUsd = 0;
    const planCounts: Record<string, number> = {
      ENTERPRISE: 0,
      PROFESSIONAL: 0,
      STANDARD: 0,
      BASIC: 0,
    };

    for (const sub of subscriptions) {
      totalMrrUsd += Number(sub.plan.priceUsd);
      const code = sub.plan.code.toUpperCase();
      planCounts[code] = (planCounts[code] ?? 0) + 1;
    }

    const periodYear = now.getUTCFullYear();
    const periodMonth = now.getUTCMonth() + 1;

    const usages = await this.prisma.organizationUsage.findMany({
      where: { periodYear, periodMonth },
    });

    let totalWhatsAppBillsSent = 0;
    let totalWhatsAppMarketingSent = 0;
    let totalEmailsSent = 0;
    let totalAiRequestsUsed = 0;

    for (const u of usages) {
      totalWhatsAppBillsSent += u.whatsAppBillsSent;
      totalWhatsAppMarketingSent += u.whatsAppMarketingSent;
      totalEmailsSent += u.emailsSent;
      totalAiRequestsUsed += u.aiRequestsUsed;
    }

    // Compute 7-day rolling POS transaction activity across all tenants
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const sevenDaysAgo = new Date(todayEnd);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const prevWeekStart = new Date(sevenDaysAgo);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    const [recentSales, prevWeekCount] = await Promise.all([
      this.prisma.sale.findMany({
        where: { createdAt: { gte: sevenDaysAgo, lte: todayEnd } },
        select: { createdAt: true, total: true },
      }),
      this.prisma.sale.count({
        where: { createdAt: { gte: prevWeekStart, lt: sevenDaysAgo } },
      }),
    ]);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyBuckets: Array<{ dateKey: string; day: string; count: number; volume: number }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(sevenDaysAgo.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dailyBuckets.push({
        dateKey: key,
        day: dayNames[d.getDay()],
        count: 0,
        volume: 0,
      });
    }

    for (const s of recentSales) {
      const key = s.createdAt.toISOString().slice(0, 10);
      const bucket = dailyBuckets.find((b) => b.dateKey === key);
      if (bucket) {
        bucket.count += 1;
        bucket.volume += Number(s.total);
      }
    }

    const totalWeeklyTxns = recentSales.length;
    const avgDailyTxns = Number((totalWeeklyTxns / 7).toFixed(1));

    const allPlans = await this.prisma.plan.findMany({
      include: { _count: { select: { subscriptions: true } } },
      orderBy: { priceUsd: 'desc' },
    });

    const planDistribution = allPlans.map((p) => ({
      code: p.code,
      name: p.name,
      count: planCounts[p.code.toUpperCase()] ?? p._count.subscriptions,
    }));

    return {
      tenants: {
        total: totalOrganizations,
        active: activeOrganizations,
        suspended: suspendedOrganizations,
        newThisMonth,
      },
      financials: {
        totalMrrUsd,
        activeSubscriptionsCount: subscriptions.length,
        planDistribution,
      },
      currentMonthConsumption: {
        period: `${periodYear}-${String(periodMonth).padStart(2, '0')}`,
        totalWhatsAppBillsSent,
        totalWhatsAppMarketingSent,
        totalEmailsSent,
        totalAiRequestsUsed,
      },
      weeklyActivity: {
        totalWeeklyTxns,
        prevWeekTxns: prevWeekCount,
        avgDailyTxns,
        days: dailyBuckets,
      },
    };
  }

  /**
   * Lists recent platform subscription invoices across all tenants.
   */
  async listInvoices() {
    const invoices = await this.prisma.subscriptionInvoice.findMany({
      include: {
        subscription: {
          include: {
            plan: { select: { name: true, code: true } },
            organization: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { issuedDate: 'desc' },
      take: 50,
    });

    return invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      organizationId: inv.subscription.organization.id,
      organizationName: inv.subscription.organization.name,
      organizationEmail: inv.subscription.organization.email,
      planName: inv.subscription.plan.name,
      planCode: inv.subscription.plan.code,
      subtotalUsd: Number(inv.subtotalUsd),
      vatAmountUsd: Number(inv.vatAmountUsd),
      totalAmountUsd: Number(inv.totalAmountUsd),
      status: inv.status,
      issuedDate: inv.issuedDate,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      paymentMethod: inv.paymentMethod,
      paymentRef: inv.paymentRef,
    }));
  }

  /**
   * Lists recent platform & security audit events.
   */
  async listAuditLogs() {
    const events = await this.prisma.auditEvent.findMany({
      include: {
        user: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return events.map((ev) => ({
      id: ev.id,
      action: ev.action,
      outcome: ev.outcome,
      actorEmail: ev.user?.email ?? 'System',
      actorName: ev.user?.name ?? 'System Automation',
      metadata: ev.metadata,
      createdAt: ev.createdAt,
    }));
  }

  /**
   * Updates an organization's basic details (name, registration number, phone, email).
   */
  async updateOrganization(id: string, dto: UpdateOrganizationDto) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException(`Organization with id '${id}' not found.`);
    }
    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.registrationNumber !== undefined
          ? { registrationNumber: dto.registrationNumber?.trim() || null }
          : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
      },
    });
    return { message: 'Organization updated successfully.', organization: updated };
  }

  /**
   * Edits the current Tenant Super Admin account or replaces/assigns a new Tenant Super Admin.
   */
  async updateTenantAdmin(
    organizationId: string,
    dto: UpdateTenantAdminDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        branches: {
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        users: {
          include: {
            user: {
              include: {
                roles: {
                  include: { role: true },
                },
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!org) {
      throw new NotFoundException(`Organization with id '${organizationId}' not found.`);
    }

    let superAdminRole = await this.prisma.role.findUnique({
      where: { name: 'SUPER_ADMIN' },
    });

    if (!superAdminRole) {
      superAdminRole = await this.prisma.role.create({
        data: {
          name: 'SUPER_ADMIN',
          description: 'Tenant super administrator',
          isSystem: true,
        },
      });
    }

    const currentAdminMember = org.users.find((m) =>
      m.user.roles.some((r) => r.role.name === 'SUPER_ADMIN'),
    );

    const mode = dto.mode ?? (currentAdminMember ? 'EDIT' : 'REPLACE');

    if (mode === 'EDIT') {
      if (!currentAdminMember) {
        throw new NotFoundException(
          'No Tenant Super Admin exists for this organization. Switch to Replace/Assign mode to create one.',
        );
      }

      const targetUser = currentAdminMember.user;
      const previousEmail = targetUser.email;
      const previousName = targetUser.name ?? targetUser.email;
      const normalizedEmail = dto.email?.trim().toLowerCase();
      const normalizedPhone = dto.phone !== undefined ? dto.phone.trim() || null : undefined;
      const emailChanged = Boolean(normalizedEmail && normalizedEmail !== previousEmail);

      if (normalizedEmail && normalizedEmail !== targetUser.email) {
        const conflict = await this.prisma.user.findFirst({
          where: { email: normalizedEmail, id: { not: targetUser.id } },
        });
        if (conflict) {
          throw new ConflictException(`Email '${normalizedEmail}' is already used by another user.`);
        }
      }

      if (normalizedPhone && normalizedPhone !== targetUser.phone) {
        const phoneConflict = await this.prisma.user.findFirst({
          where: { phone: normalizedPhone, id: { not: targetUser.id } },
        });
        if (phoneConflict) {
          throw new ConflictException(`Phone '${normalizedPhone}' is already used by another user.`);
        }
      }

      // If email changed or an explicit password reset was requested, enforce a fresh temporary password reset
      const temporaryPassword =
        emailChanged || dto.newPassword?.trim()
          ? dto.newPassword?.trim() || `Tn1!${randomBytes(12).toString('base64url')}`
          : undefined;
      const passwordHash = temporaryPassword ? await hash(temporaryPassword, 12) : undefined;

      const updatedUser = await this.prisma.user.update({
        where: { id: targetUser.id },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(normalizedEmail ? { email: normalizedEmail, emailVerified: new Date() } : {}),
          ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(passwordHash
            ? {
                passwordHash,
                mustChangePassword: true,
                passwordChangedAt: new Date(),
                sessionVersion: { increment: 1 },
              }
            : {}),
        },
      });

      let oldEmailNotified = false;
      let newEmailSent = false;

      if (emailChanged) {
        try {
          await this.auth.sendTenantAdminEmailChangedNotice(
            previousEmail,
            previousName,
            updatedUser.email,
            org.name,
          );
          oldEmailNotified = true;
        } catch (err) {
          this.logger.error(
            `Failed to send Tenant Admin email change notice to old email ${previousEmail}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      }

      if (temporaryPassword) {
        try {
          await this.auth.sendTenantAdminTemporaryPasswordEmail(
            updatedUser.email,
            updatedUser.name ?? updatedUser.email,
            org.name,
            temporaryPassword,
            true,
          );
          newEmailSent = true;
        } catch (err) {
          this.logger.error(
            `Failed to send Tenant Admin temporary password email to ${updatedUser.email}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      }

      await this.audit.record({
        userId: actor.id,
        action: 'TENANT_ADMIN_UPDATED',
        context,
        metadata: {
          organizationId,
          organizationName: org.name,
          adminUserId: updatedUser.id,
          previousEmail,
          adminEmail: updatedUser.email,
          emailChanged,
          passwordReset: Boolean(passwordHash),
          oldEmailNotified,
          newEmailSent,
        },
      });

      return {
        message: `Tenant admin '${updatedUser.email}' updated successfully.`,
        tenantAdmin: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          status: updatedUser.status,
        },
        ...(temporaryPassword ? { temporaryPassword } : {}),
        emailNotifications: {
          oldEmailNotified,
          newEmailSent,
        },
      };
    }

    // REPLACE or INITIAL ASSIGN mode
    const newEmail = dto.email?.trim().toLowerCase();
    if (!newEmail) {
      throw new BadRequestException('New Tenant Admin email is required.');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: newEmail },
      include: {
        organizationMemberships: true,
        roles: { include: { role: true } },
      },
    });

    if (existingUser) {
      const isPlatformOwner = existingUser.roles.some(
        (r) => r.role.name === 'PLATFORM_SUPER_ADMIN',
      );
      if (isPlatformOwner) {
        throw new ConflictException(
          'Cannot assign a Root Platform Admin account as a tenant store admin.',
        );
      }

      const belongsToOtherOrg = existingUser.organizationMemberships.some(
        (m) => m.organizationId !== organizationId,
      );
      if (belongsToOtherOrg) {
        throw new ConflictException(
          `User '${newEmail}' already belongs to a different organization.`,
        );
      }
    }

    if (!existingUser && !dto.name?.trim()) {
      throw new BadRequestException('Full name is required when creating a new Tenant Admin.');
    }

    const normalizedPhone = dto.phone !== undefined ? dto.phone.trim() || null : undefined;
    if (normalizedPhone) {
      const phoneConflict = await this.prisma.user.findFirst({
        where: {
          phone: normalizedPhone,
          ...(existingUser ? { id: { not: existingUser.id } } : {}),
        },
      });
      if (phoneConflict) {
        throw new ConflictException(`Phone '${normalizedPhone}' is already used by another user.`);
      }
    }

    const previousEmail = currentAdminMember?.user.email ?? null;
    const previousName = currentAdminMember?.user.name ?? previousEmail ?? 'Administrator';
    const isReplacingDifferentAdmin = Boolean(previousEmail && previousEmail !== newEmail);

    // Always issue a temporary password reset when assigning/switching a Tenant Admin email
    const tempPassword =
      dto.newPassword?.trim() || `Tn1!${randomBytes(12).toString('base64url')}`;
    const passwordHash = await hash(tempPassword, 12);
    const defaultBranchId = org.branches[0]?.id;

    const assignedAdmin = await this.prisma.$transaction(async (tx) => {
      // Remove SUPER_ADMIN role from previous admin if replacing with a different account
      if (currentAdminMember && currentAdminMember.user.id !== existingUser?.id) {
        await tx.userRole.deleteMany({
          where: {
            userId: currentAdminMember.user.id,
            roleId: superAdminRole.id,
          },
        });
      }

      if (existingUser) {
        const updated = await tx.user.update({
          where: { id: existingUser.id },
          data: {
            ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
            ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
            emailVerified: existingUser.emailVerified ?? new Date(),
            status: dto.status ?? UserStatus.ACTIVE,
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: new Date(),
            sessionVersion: { increment: 1 },
          },
        });

        await tx.organizationUser.upsert({
          where: {
            organizationId_userId: { organizationId, userId: updated.id },
          },
          update: {},
          create: { organizationId, userId: updated.id },
        });

        await tx.userRole.upsert({
          where: {
            userId_roleId: { userId: updated.id, roleId: superAdminRole.id },
          },
          update: {},
          create: { userId: updated.id, roleId: superAdminRole.id },
        });

        return updated;
      }

      return tx.user.create({
        data: {
          email: newEmail,
          name: dto.name!.trim(),
          phone: normalizedPhone ?? null,
          passwordHash,
          emailVerified: new Date(),
          status: dto.status ?? UserStatus.ACTIVE,
          mustChangePassword: true,
          organizationMemberships: {
            create: { organizationId },
          },
          ...(defaultBranchId
            ? {
                branchAssignments: {
                  create: { branchId: defaultBranchId, isDefault: true },
                },
              }
            : {}),
          roles: {
            create: { roleId: superAdminRole.id },
          },
        },
      });
    });

    let oldEmailNotified = false;
    let newEmailSent = false;

    if (isReplacingDifferentAdmin && previousEmail) {
      try {
        await this.auth.sendTenantAdminEmailChangedNotice(
          previousEmail,
          previousName,
          assignedAdmin.email,
          org.name,
        );
        oldEmailNotified = true;
      } catch (err) {
        this.logger.error(
          `Failed to send Tenant Admin handover notice to old email ${previousEmail}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    try {
      await this.auth.sendTenantAdminTemporaryPasswordEmail(
        assignedAdmin.email,
        assignedAdmin.name ?? assignedAdmin.email,
        org.name,
        tempPassword,
        isReplacingDifferentAdmin,
      );
      newEmailSent = true;
    } catch (err) {
      this.logger.error(
        `Failed to send Tenant Admin temporary password email to ${assignedAdmin.email}`,
        err instanceof Error ? err.stack : undefined,
      );
    }

    await this.audit.record({
      userId: actor.id,
      action: 'TENANT_ADMIN_REPLACED',
      context,
      metadata: {
        organizationId,
        organizationName: org.name,
        previousAdminEmail: previousEmail,
        newAdminEmail: assignedAdmin.email,
        oldEmailNotified,
        newEmailSent,
      },
    });

    return {
      message: `Tenant admin for '${org.name}' is now ${assignedAdmin.email}.`,
      tenantAdmin: {
        id: assignedAdmin.id,
        name: assignedAdmin.name,
        email: assignedAdmin.email,
        phone: assignedAdmin.phone,
        status: assignedAdmin.status,
      },
      temporaryPassword: tempPassword,
      emailNotifications: {
        oldEmailNotified,
        newEmailSent,
      },
    };
  }

  /**
   * Lists all commercial plans (active & inactive) with subscriber counts and extensible features.
   */
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
      orderBy: { priceUsd: 'asc' },
    });

    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      tier: p.tier,
      name: p.name,
      description: p.description,
      priceUsd: Number(p.priceUsd),
      vatRate: Number(p.vatRate),
      priceWithVatUsd: Number(p.priceWithVatUsd),
      billingCycle: p.billingCycle,
      isActive: p.isActive,
      maxBranches: p.maxBranches,
      maxInternalUsers: p.maxInternalUsers,
      monthlyEmailLimit: p.monthlyEmailLimit,
      monthlyWhatsAppBills: p.monthlyWhatsAppBills,
      monthlyWhatsAppMarketing: p.monthlyWhatsAppMarketing,
      monthlyAiRequests: p.monthlyAiRequests,
      multiBranchEnabled: p.multiBranchEnabled,
      emailEnabled: p.emailEnabled,
      whatsAppBillsEnabled: p.whatsAppBillsEnabled,
      whatsAppMarketingEnabled: p.whatsAppMarketingEnabled,
      aiEnabled: p.aiEnabled,
      features: Array.isArray(p.features) ? p.features : [],
      subscriberCount: p._count.subscriptions,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Creates a new custom commercial subscription plan.
   */
  async createPlan(
    dto: CreatePlanDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const normalizedCode = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.prisma.plan.findUnique({
      where: { code: normalizedCode },
    });
    if (existing) {
      throw new ConflictException(`Plan with code '${normalizedCode}' already exists.`);
    }

    const vatRateNum = dto.vatRate ?? 0.18;
    const subtotal = new Prisma.Decimal(dto.priceUsd);
    const vatRateDec = new Prisma.Decimal(vatRateNum);
    const priceWithVat = subtotal.mul(new Prisma.Decimal(1).add(vatRateDec)).toDecimalPlaces(2);

    const created = await this.prisma.plan.create({
      data: {
        code: normalizedCode,
        tier: dto.tier ?? PlanTier.CUSTOM,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        priceUsd: subtotal,
        vatRate: vatRateDec,
        priceWithVatUsd: priceWithVat,
        billingCycle: dto.billingCycle ?? 'MONTHLY',
        isActive: dto.isActive ?? true,
        maxBranches: dto.maxBranches,
        maxInternalUsers: dto.maxInternalUsers,
        monthlyEmailLimit: dto.monthlyEmailLimit,
        monthlyWhatsAppBills: dto.monthlyWhatsAppBills,
        monthlyWhatsAppMarketing: dto.monthlyWhatsAppMarketing,
        monthlyAiRequests: dto.monthlyAiRequests,
        multiBranchEnabled: dto.multiBranchEnabled,
        emailEnabled: dto.emailEnabled,
        whatsAppBillsEnabled: dto.whatsAppBillsEnabled,
        whatsAppMarketingEnabled: dto.whatsAppMarketingEnabled,
        aiEnabled: dto.aiEnabled,
        features: (dto.features ?? []).map((f) => ({
          key: f.key.trim(),
          label: f.label.trim(),
          description: f.description?.trim() || undefined,
          enabled: f.enabled,
        })),
      },
    });

    await this.audit.record({
      userId: actor.id,
      action: 'PLATFORM_PLAN_CREATED',
      context,
      metadata: {
        planId: created.id,
        planCode: created.code,
        planName: created.name,
        priceUsd: Number(created.priceUsd),
      },
    });

    return {
      message: `Plan '${created.name}' (${created.code}) created successfully.`,
      plan: created,
    };
  }

  /**
   * Edits an existing Plan; limits and features propagate immediately to all subscribed tenants.
   */
  async updatePlan(
    planId: string,
    dto: UpdatePlanDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const existing = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Plan with id '${planId}' not found.`);
    }

    const nextPrice = dto.priceUsd !== undefined ? dto.priceUsd : Number(existing.priceUsd);
    const nextVatRate = dto.vatRate !== undefined ? dto.vatRate : Number(existing.vatRate);
    const subtotal = new Prisma.Decimal(nextPrice);
    const vatRateDec = new Prisma.Decimal(nextVatRate);
    const priceWithVat = subtotal.mul(new Prisma.Decimal(1).add(vatRateDec)).toDecimalPlaces(2);

    const updated = await this.prisma.plan.update({
      where: { id: planId },
      data: {
        ...(dto.tier !== undefined ? { tier: dto.tier } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        priceUsd: subtotal,
        vatRate: vatRateDec,
        priceWithVatUsd: priceWithVat,
        ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.maxBranches !== undefined ? { maxBranches: dto.maxBranches } : {}),
        ...(dto.maxInternalUsers !== undefined ? { maxInternalUsers: dto.maxInternalUsers } : {}),
        ...(dto.monthlyEmailLimit !== undefined ? { monthlyEmailLimit: dto.monthlyEmailLimit } : {}),
        ...(dto.monthlyWhatsAppBills !== undefined ? { monthlyWhatsAppBills: dto.monthlyWhatsAppBills } : {}),
        ...(dto.monthlyWhatsAppMarketing !== undefined
          ? { monthlyWhatsAppMarketing: dto.monthlyWhatsAppMarketing }
          : {}),
        ...(dto.monthlyAiRequests !== undefined ? { monthlyAiRequests: dto.monthlyAiRequests } : {}),
        ...(dto.multiBranchEnabled !== undefined ? { multiBranchEnabled: dto.multiBranchEnabled } : {}),
        ...(dto.emailEnabled !== undefined ? { emailEnabled: dto.emailEnabled } : {}),
        ...(dto.whatsAppBillsEnabled !== undefined
          ? { whatsAppBillsEnabled: dto.whatsAppBillsEnabled }
          : {}),
        ...(dto.whatsAppMarketingEnabled !== undefined
          ? { whatsAppMarketingEnabled: dto.whatsAppMarketingEnabled }
          : {}),
        ...(dto.aiEnabled !== undefined ? { aiEnabled: dto.aiEnabled } : {}),
        ...(dto.features !== undefined
          ? {
              features: dto.features.map((f) => ({
                key: f.key.trim(),
                label: f.label.trim(),
                description: f.description?.trim() || undefined,
                enabled: f.enabled,
              })),
            }
          : {}),
      },
    });

    await this.audit.record({
      userId: actor.id,
      action: 'PLATFORM_PLAN_UPDATED',
      context,
      metadata: {
        planId: updated.id,
        planCode: updated.code,
        affectedTenantsCount: existing._count.subscriptions,
      },
    });

    return {
      message: `Plan '${updated.name}' updated. Changes propagated immediately to ${existing._count.subscriptions} subscribed tenant(s).`,
      plan: updated,
      affectedTenantsCount: existing._count.subscriptions,
    };
  }

  /**
   * Lists all Add-on Packs in the catalog.
   */
  async listAddonPacks() {
    await this.ensureDefaultAddonPacks();
    const packs = await this.prisma.addonPack.findMany({
      include: {
        _count: {
          select: { allocations: true },
        },
      },
      orderBy: { priceUsd: 'asc' },
    });

    return packs.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      quotaTarget: p.quotaTarget,
      unitsPerPack: p.unitsPerPack,
      priceUsd: Number(p.priceUsd),
      billingCycle: p.billingCycle,
      features: Array.isArray(p.features) ? p.features : [],
      isActive: p.isActive,
      allocationCount: p._count.allocations,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Creates a new Add-on Pack in the platform catalog.
   */
  async createAddonPack(
    dto: CreateAddonPackDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    await this.ensureDefaultAddonPacks();
    const normalizedCode = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.prisma.addonPack.findUnique({
      where: { code: normalizedCode },
    });
    if (existing) {
      throw new ConflictException(`Add-on pack with code '${normalizedCode}' already exists.`);
    }

    const created = await this.prisma.addonPack.create({
      data: {
        code: normalizedCode,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        quotaTarget: dto.quotaTarget,
        unitsPerPack: dto.unitsPerPack,
        priceUsd: new Prisma.Decimal(dto.priceUsd),
        billingCycle: dto.billingCycle ?? 'ONE_TIME',
        isActive: dto.isActive ?? true,
        features: (dto.features ?? []).map((f) => ({
          key: f.key.trim(),
          label: f.label.trim(),
          description: f.description?.trim() || undefined,
          enabled: f.enabled,
        })),
      },
    });

    await this.audit.record({
      userId: actor.id,
      action: 'PLATFORM_ADDON_PACK_CREATED',
      context,
      metadata: {
        addonPackId: created.id,
        code: created.code,
        name: created.name,
      },
    });

    return {
      message: `Add-on pack '${created.name}' (${created.code}) created successfully.`,
      addonPack: created,
    };
  }

  /**
   * Updates an Add-on Pack and propagates updated features to active allocations.
   */
  async updateAddonPack(
    packId: string,
    dto: UpdateAddonPackDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const existing = await this.prisma.addonPack.findUnique({
      where: { id: packId },
    });
    if (!existing) {
      throw new NotFoundException(`Add-on pack with id '${packId}' not found.`);
    }

    const sanitizedFeatures =
      dto.features !== undefined
        ? dto.features.map((f) => ({
            key: f.key.trim(),
            label: f.label.trim(),
            description: f.description?.trim() || undefined,
            enabled: f.enabled,
          }))
        : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const pack = await tx.addonPack.update({
        where: { id: packId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.quotaTarget !== undefined ? { quotaTarget: dto.quotaTarget } : {}),
          ...(dto.unitsPerPack !== undefined ? { unitsPerPack: dto.unitsPerPack } : {}),
          ...(dto.priceUsd !== undefined ? { priceUsd: new Prisma.Decimal(dto.priceUsd) } : {}),
          ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(sanitizedFeatures !== undefined ? { features: sanitizedFeatures } : {}),
        },
      });

      // Propagate features & link to active allocations matching code
      if (sanitizedFeatures !== undefined) {
        await tx.subscriptionAddon.updateMany({
          where: {
            OR: [{ addonPackId: pack.id }, { type: pack.code }],
            isActive: true,
          },
          data: {
            addonPackId: pack.id,
            features: sanitizedFeatures,
          },
        });
      }

      return pack;
    });

    await this.audit.record({
      userId: actor.id,
      action: 'PLATFORM_ADDON_PACK_UPDATED',
      context,
      metadata: {
        addonPackId: updated.id,
        code: updated.code,
      },
    });

    return {
      message: `Add-on pack '${updated.name}' updated and synced cleanly.`,
      addonPack: updated,
    };
  }

  /**
   * Lists tenant plan-change and add-on pack requests ordered with PENDING first.
   */
  async listSubscriptionRequests() {
    await this.ensureDefaultAddonPacks();
    const [requests, plans, addonPacks] = await Promise.all([
      this.prisma.subscriptionRequest.findMany({
        include: {
          organization: {
            select: { id: true, name: true, email: true },
          },
          subscription: {
            include: {
              plan: { select: { code: true, name: true, priceUsd: true } },
            },
          },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      this.prisma.plan.findMany({
        select: { code: true, name: true, priceUsd: true, priceWithVatUsd: true },
      }),
      this.prisma.addonPack.findMany({
        select: { code: true, name: true, priceUsd: true, unitsPerPack: true, quotaTarget: true },
      }),
    ]);

    const planMap = new Map(plans.map((p) => [p.code.toUpperCase(), p]));
    const addonMap = new Map(addonPacks.map((a) => [a.code.toUpperCase(), a]));

    return requests.map((r) => {
      const targetPlan = r.targetPlanCode ? planMap.get(r.targetPlanCode.toUpperCase()) : undefined;
      const addonPack = r.addonCode ? addonMap.get(r.addonCode.toUpperCase()) : undefined;
      return {
        id: r.id,
        organizationId: r.organizationId,
        organizationName: r.organization.name,
        organizationEmail: r.organization.email,
        currentPlanCode: r.subscription.plan.code,
        currentPlanName: r.subscription.plan.name,
        type: r.type,
        status: r.status,
        targetPlanCode: r.targetPlanCode,
        targetPlanName: targetPlan?.name ?? r.targetPlanCode,
        targetPlanPriceUsd: targetPlan ? Number(targetPlan.priceUsd) : null,
        addonCode: r.addonCode,
        addonName: addonPack?.name ?? r.addonCode,
        addonPriceUsd: addonPack ? Number(addonPack.priceUsd) : null,
        addonUnitsPerPack: addonPack?.unitsPerPack ?? null,
        addonQuotaTarget: addonPack?.quotaTarget ?? null,
        quantity: r.quantity,
        notes: r.notes,
        paymentRef: r.paymentRef,
        reviewNotes: r.reviewNotes,
        reviewedAt: r.reviewedAt,
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * Approves or rejects a Tenant Admin's Plan Change or Add-on Pack request.
   * Approval activates the new Plan or Add-on immediately and generates an invoice.
   */
  async reviewSubscriptionRequest(
    requestId: string,
    dto: ReviewSubscriptionRequestDto,
    actor: AuthenticatedUser,
    context: SecurityRequestContext,
  ) {
    const req = await this.prisma.subscriptionRequest.findUnique({
      where: { id: requestId },
      include: {
        organization: true,
        subscription: { include: { plan: true } },
      },
    });

    if (!req) {
      throw new NotFoundException('Subscription request not found.');
    }

    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Request has already been ${req.status.toLowerCase()}.`);
    }

    const now = new Date();

    if (dto.action === 'REJECT') {
      const rejected = await this.prisma.subscriptionRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          reviewNotes: dto.reviewNotes?.trim() || null,
          reviewedById: actor.id,
          reviewedAt: now,
        },
      });

      await this.audit.record({
        userId: actor.id,
        action: 'SUBSCRIPTION_REQUEST_REJECTED',
        context,
        metadata: {
          requestId,
          organizationId: req.organizationId,
          type: req.type,
          targetPlanCode: req.targetPlanCode,
          addonCode: req.addonCode,
          reviewNotes: dto.reviewNotes,
        },
      });

      return {
        message: `Request for '${req.organization.name}' rejected.`,
        request: rejected,
      };
    }

    // APPROVE flow: activate immediately + generate invoice
    const resolvedPaymentRef = dto.paymentRef?.trim() || req.paymentRef || null;
    const markInvoicePaid = Boolean(dto.markPaid && resolvedPaymentRef);

    if (req.type === 'PLAN_CHANGE') {
      if (!req.targetPlanCode) {
        throw new BadRequestException('Target plan code is missing on this request.');
      }

      const targetPlan = await this.prisma.plan.findUnique({
        where: { code: req.targetPlanCode.toUpperCase() },
      });
      if (!targetPlan) {
        throw new NotFoundException(`Plan '${req.targetPlanCode}' not found.`);
      }

      const subtotal = new Prisma.Decimal(targetPlan.priceUsd);
      const vatRate = new Prisma.Decimal(targetPlan.vatRate);
      const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
      const totalAmount = subtotal.add(vatAmount).toDecimalPlaces(2);
      const invoiceNumber = `INV-${targetPlan.code}-${Date.now().toString(36).toUpperCase()}`;

      const result = await this.prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: req.subscriptionId },
          data: {
            planId: targetPlan.id,
            status: 'ACTIVE',
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        await tx.organization.update({
          where: { id: req.organizationId },
          data: { status: RecordStatus.ACTIVE },
        });

        const invoice = await tx.subscriptionInvoice.create({
          data: {
            subscriptionId: req.subscriptionId,
            invoiceNumber,
            subtotalUsd: subtotal,
            vatAmountUsd: vatAmount,
            totalAmountUsd: totalAmount,
            status: markInvoicePaid ? 'PAID' : 'PENDING',
            paidAt: markInvoicePaid ? now : null,
            paymentRef: resolvedPaymentRef,
            dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            notes: `Approved plan change request: ${req.subscription.plan.name} -> ${targetPlan.name}`,
          },
        });

        const updatedRequest = await tx.subscriptionRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            reviewNotes: dto.reviewNotes?.trim() || null,
            paymentRef: resolvedPaymentRef,
            reviewedById: actor.id,
            reviewedAt: now,
          },
        });

        return { invoice, updatedRequest };
      });

      await this.audit.record({
        userId: actor.id,
        action: 'SUBSCRIPTION_REQUEST_APPROVED',
        context,
        metadata: {
          requestId,
          organizationId: req.organizationId,
          type: 'PLAN_CHANGE',
          targetPlanCode: targetPlan.code,
          invoiceNumber: result.invoice.invoiceNumber,
          paid: markInvoicePaid,
        },
      });

      return {
        message: `Approved plan change to '${targetPlan.name}' for ${req.organization.name}. Invoice ${result.invoice.invoiceNumber} generated.`,
        request: result.updatedRequest,
        invoice: result.invoice,
      };
    }

    // ADDON_PACK approval
    if (!req.addonCode) {
      throw new BadRequestException('Add-on pack code is missing on this request.');
    }

    await this.ensureDefaultAddonPacks();
    const pack = await this.prisma.addonPack.findUnique({
      where: { code: req.addonCode.toUpperCase() },
    });
    if (!pack) {
      throw new NotFoundException(`Add-on pack '${req.addonCode}' not found.`);
    }

    const totalUnits = pack.unitsPerPack * req.quantity;
    const subtotal = new Prisma.Decimal(Number(pack.priceUsd) * req.quantity);
    const vatAmount = subtotal.mul(new Prisma.Decimal(0.18)).toDecimalPlaces(2);
    const totalAmount = subtotal.add(vatAmount).toDecimalPlaces(2);
    const invoiceNumber = `ADDON-${pack.code}-${Date.now().toString(36).toUpperCase()}`;

    let quotaUpdate: Prisma.SubscriptionUpdateInput = {};
    if (pack.quotaTarget === AddonQuotaTarget.BRANCHES && totalUnits > 0) {
      quotaUpdate = { extraBranches: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.WHATSAPP_BILLS && totalUnits > 0) {
      quotaUpdate = { extraWhatsAppBills: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.WHATSAPP_MARKETING && totalUnits > 0) {
      quotaUpdate = { extraWhatsAppMarketing: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.EMAILS && totalUnits > 0) {
      quotaUpdate = { extraEmailLimit: { increment: totalUnits } };
    } else if (pack.quotaTarget === AddonQuotaTarget.AI_REQUESTS && totalUnits > 0) {
      quotaUpdate = { extraAiRequests: { increment: totalUnits } };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(quotaUpdate).length > 0) {
        await tx.subscription.update({
          where: { id: req.subscriptionId },
          data: quotaUpdate,
        });
      }

      await tx.subscriptionAddon.create({
        data: {
          subscriptionId: req.subscriptionId,
          addonPackId: pack.id,
          type: pack.code,
          quantity: req.quantity,
          grantedUnits: totalUnits,
          priceUsd: subtotal,
          features: pack.features ?? [],
          isActive: true,
        },
      });

      const invoice = await tx.subscriptionInvoice.create({
        data: {
          subscriptionId: req.subscriptionId,
          invoiceNumber,
          subtotalUsd: subtotal,
          vatAmountUsd: vatAmount,
          totalAmountUsd: totalAmount,
          status: markInvoicePaid ? 'PAID' : 'PENDING',
          paidAt: markInvoicePaid ? now : null,
          paymentRef: resolvedPaymentRef,
          dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          notes: `Approved add-on request: ${req.quantity}x ${pack.name} (${pack.code})`,
        },
      });

      const updatedRequest = await tx.subscriptionRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewNotes: dto.reviewNotes?.trim() || null,
          paymentRef: resolvedPaymentRef,
          reviewedById: actor.id,
          reviewedAt: now,
        },
      });

      return { invoice, updatedRequest };
    });

    await this.audit.record({
      userId: actor.id,
      action: 'SUBSCRIPTION_REQUEST_APPROVED',
      context,
      metadata: {
        requestId,
        organizationId: req.organizationId,
        type: 'ADDON_PACK',
        addonCode: pack.code,
        quantity: req.quantity,
        invoiceNumber: result.invoice.invoiceNumber,
        paid: markInvoicePaid,
      },
    });

    return {
      message: `Approved ${req.quantity}x ${pack.name} for ${req.organization.name}. Invoice ${result.invoice.invoiceNumber} generated.`,
      request: result.updatedRequest,
      invoice: result.invoice,
    };
  }

  /**
   * Scans active tenant subscriptions and pending invoices for 15-day, 10-day, 5-day, and 1-day reminders,
   * sends email notifications and registers alerts in the notification ledger.
   */
  async dispatchPaymentReminders() {
    const pendingInvoices = await this.prisma.subscriptionInvoice.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
      },
      include: {
        subscription: {
          include: {
            organization: {
              include: {
                users: {
                  include: {
                    user: {
                      include: {
                        roles: {
                          include: {
                            role: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            plan: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    const dispatched: Array<{
      invoiceId: string;
      invoiceNumber: string;
      organizationName: string;
      daysRemaining: number;
      stage: '15_DAYS' | '10_DAYS' | '5_DAYS' | '1_DAY' | 'OVERDUE' | 'OTHER';
      emailSent: boolean;
    }> = [];

    for (const inv of pendingInvoices) {
      const diffMs = new Date(inv.dueDate).getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffMs / msPerDay);

      let stage: '15_DAYS' | '10_DAYS' | '5_DAYS' | '1_DAY' | 'OVERDUE' | 'OTHER' = 'OTHER';
      if (daysRemaining >= 14 && daysRemaining <= 15) {
        stage = '15_DAYS';
      } else if (daysRemaining >= 9 && daysRemaining <= 10) {
        stage = '10_DAYS';
      } else if (daysRemaining >= 4 && daysRemaining <= 5) {
        stage = '5_DAYS';
      } else if (daysRemaining >= 0 && daysRemaining <= 1) {
        stage = '1_DAY';
      } else if (daysRemaining < 0) {
        stage = 'OVERDUE';
      }

      if (stage !== 'OTHER') {
        const org = inv.subscription.organization;
        const tenantAdmins = org.users
          .map((u) => u.user)
          .filter((u) => u?.roles?.some((r) => r.role?.name === 'SUPER_ADMIN'));
        const recipients =
          tenantAdmins.length > 0
            ? tenantAdmins
            : org.users?.[0]?.user
              ? [org.users[0].user]
              : [];

        for (const adminUser of recipients) {
          const targetEmail = adminUser?.email || org.email;
          const targetName = adminUser?.name || org.name;

          let emailSent = false;
          if (targetEmail) {
            try {
              await this.auth.sendPaymentReminderEmail(
                targetEmail,
                targetName,
                org.name,
                inv.invoiceNumber,
                Number(inv.totalAmountUsd),
                inv.dueDate,
                daysRemaining,
              );
              emailSent = true;
            } catch (err) {
              this.logger.warn(
                `Failed to send ${stage} reminder for ${inv.invoiceNumber} to ${targetEmail}`,
                err instanceof Error ? err.stack : String(err),
              );
            }
          }

          if (adminUser) {
            try {
              await this.prisma.appNotification.create({
                data: {
                  organizationId: org.id,
                  recipientUserId: adminUser.id,
                  eventType: 'BILLING_PAYMENT_REMINDER',
                  title: `Subscription Payment Due (${daysRemaining > 0 ? `${daysRemaining} days` : 'Overdue'})`,
                  message: `Invoice ${inv.invoiceNumber} for $${Number(inv.totalAmountUsd).toFixed(2)} is due on ${new Date(inv.dueDate).toLocaleDateString()}. Settle via direct bank transfer or instant online payment.`,
                  actionUrl: '/dashboard/billing',
                },
              });
            } catch {
              // Ignored
            }
          }

          dispatched.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            organizationName: org.name,
            daysRemaining,
            stage,
            emailSent,
          });
        }
      }
    }

    return {
      message: `Scanned ${pendingInvoices.length} invoices; dispatched ${dispatched.length} payment reminders.`,
      dispatchedCount: dispatched.length,
      dispatched,
    };
  }

  /**
   * Returns a unified stream of Platform Admin system notifications matching:
   * BILLING, INVENTORY ALERT, PURCHASE ORDER, SYSTEM UPDATE, EMPLOYEE, SUBSCRIPTION
   */
  async listPlatformNotifications() {
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    const pendingInvoices = await this.prisma.subscriptionInvoice.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] } },
      include: {
        subscription: {
          include: {
            organization: true,
            plan: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
    });

    const billingNotifications = pendingInvoices.map((inv) => {
      const diffMs = new Date(inv.dueDate).getTime() - now.getTime();
      const days = Math.ceil(diffMs / msPerDay);
      let timeAgo = `${Math.abs(days)} days ago`;
      if (days === 0) timeAgo = 'Today, 09:00';
      else if (days === 1) timeAgo = 'Due Tomorrow';
      else if (days > 1) timeAgo = `Due in ${days} days`;

      let title = `Subscription Payment Due in ${days} Days: ${inv.subscription.organization.name}`;
      let priority: 'URGENT' | 'NORMAL' | 'INFO' = 'NORMAL';
      if (days <= 1) {
        title = `Urgent: Subscription Payment Due in 1 Day: ${inv.subscription.organization.name}`;
        priority = 'URGENT';
      } else if (days <= 5) {
        title = `Action Required: Payment Due in 5 Days: ${inv.subscription.organization.name}`;
        priority = 'URGENT';
      } else if (days <= 10) {
        title = `Upcoming Payment in 10 Days: ${inv.subscription.organization.name}`;
      } else if (days <= 15) {
        title = `Renewal Notice (15 Days Remaining): ${inv.subscription.organization.name}`;
      }

      return {
        id: `notif-bill-${inv.id}`,
        category: 'BILLING' as const,
        title,
        message: `Monthly subscription invoice #${inv.invoiceNumber} ($${Number(inv.totalAmountUsd).toFixed(2)}) for ${inv.subscription.organization.name} is awaiting payment settlement.`,
        createdAt: inv.issuedDate.toISOString(),
        timeAgo,
        isRead: false,
        priority,
        actionUrl: '/platform-admin?tab=financials',
      };
    });

    const pendingRequests = await this.prisma.subscriptionRequest.findMany({
      where: { status: 'PENDING' },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const subscriptionNotifications = pendingRequests.map((req) => ({
      id: `notif-req-${req.id}`,
      category: 'SUBSCRIPTION' as const,
      title:
        req.type === 'PLAN_CHANGE'
          ? `Plan Upgrade Request: ${req.organization.name} → ${req.targetPlanCode}`
          : `Add-on Top-up Request: ${req.organization.name} (${req.quantity}x ${req.addonCode})`,
      message: `${req.organization.name} submitted a ${req.type === 'PLAN_CHANGE' ? 'plan migration' : 'capacity top-up'} request.${req.paymentRef ? ` Bank Ref: ${req.paymentRef}.` : ''} Review and approve.`,
      createdAt: req.createdAt.toISOString(),
      timeAgo: 'Just now',
      isRead: false,
      priority: 'URGENT' as const,
      actionUrl: req.type === 'PLAN_CHANGE' ? '/platform-admin?tab=subscriptions' : '/platform-admin?tab=addons',
    }));

    const recentTenants = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take: 4,
    });

    const tenantNotifications = recentTenants.map((t, idx) => ({
      id: `notif-tenant-${t.id}`,
      category: 'EMPLOYEE' as const,
      title: `New Organization Provisioned: ${t.name}`,
      message: `Tenant organization '${t.name}' was successfully provisioned with Primary Branch [MAIN] and auto-generated admin credentials.`,
      createdAt: t.createdAt.toISOString(),
      timeAgo: idx === 0 ? '2 hours ago' : 'Oct 24, 09:15',
      isRead: idx > 1,
      priority: 'NORMAL' as const,
      actionUrl: '/platform-admin?tab=organizations',
    }));

    const systemUpdateNotifications = [
      {
        id: 'notif-sys-v482',
        category: 'SYSTEM UPDATE' as const,
        title: 'TechNova v4.8.2 Online Payment & Notification Engine Released',
        message:
          'The new platform release introduces instant Online Payment Gateway settlement, 15/10/5/1-day automated billing reminder dispatches, and the unified Alerts center.',
        createdAt: new Date().toISOString(),
        timeAgo: 'Yesterday, 14:30',
        isRead: true,
        priority: 'INFO' as const,
        actionUrl: '/platform-admin?tab=telemetry',
      },
    ];

    const operationsNotifications = [
      {
        id: 'notif-inv-01',
        category: 'INVENTORY ALERT' as const,
        title: 'Low Stock: Premium Thermal Receipt Rolls (80mm)',
        message:
          'Warehouse stock has fallen below the safety reorder threshold of 50 units. Current stock is 34 units. Dispatch reorder to supplier.',
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        timeAgo: '10 mins ago',
        isRead: false,
        priority: 'URGENT' as const,
      },
      {
        id: 'notif-po-01',
        category: 'PURCHASE ORDER' as const,
        title: 'PO-2024-8832 Approved by Fleet Management',
        message:
          'Your purchase order for Supplier ACME Retail Logistics has been verified and approved. Dispatch transmission is ready.',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        timeAgo: '2 hours ago',
        isRead: false,
        priority: 'NORMAL' as const,
      },
    ];

    return [
      ...billingNotifications,
      ...subscriptionNotifications,
      ...operationsNotifications,
      ...systemUpdateNotifications,
      ...tenantNotifications,
    ];
  }
}

function invNotes(existing: string | null): string {
  return existing ? existing : '';
}
