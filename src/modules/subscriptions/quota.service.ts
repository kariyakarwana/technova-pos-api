import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../database/prisma/prisma.service';

export interface PackageFeatureItem {
  key: string;
  label: string;
  description?: string;
  enabled: boolean;
  source?: 'PLAN' | 'ADDON';
}

export interface EffectivePlanLimits {
  planName: string;
  planTier: string;
  priceUsd: number;
  priceWithVatUsd: number;
  maxBranches: number;
  maxInternalUsers: number;
  monthlyEmailLimit: number;
  monthlyWhatsAppBills: number;
  monthlyWhatsAppMarketing: number;
  monthlyAiRequests: number;
  multiBranchEnabled: boolean;
  emailEnabled: boolean;
  whatsAppBillsEnabled: boolean;
  whatsAppMarketingEnabled: boolean;
  aiEnabled: boolean;
  features: PackageFeatureItem[];
}

export interface MetricUsage {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  enabled: boolean;
}

export interface UsageOverview {
  plan: {
    tier: string;
    name: string;
    priceUsd: number;
    priceWithVatUsd: number;
    status: string;
    currentPeriodEnd: Date;
  };
  features: PackageFeatureItem[];
  metrics: {
    branches: MetricUsage;
    users: MetricUsage;
    transactionalEmails: MetricUsage;
    whatsAppBills: MetricUsage;
    whatsAppMarketing: MetricUsage;
    aiRequests: MetricUsage;
  };
}

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private parseFeatures(
    raw: unknown,
    source: 'PLAN' | 'ADDON',
  ): PackageFeatureItem[] {
    if (!Array.isArray(raw)) return [];
    const items: PackageFeatureItem[] = [];
    for (const item of raw) {
      if (
        item &&
        typeof item === 'object' &&
        'key' in item &&
        'label' in item &&
        typeof (item as { key: unknown }).key === 'string' &&
        typeof (item as { label: unknown }).label === 'string'
      ) {
        const entry = item as {
          key: string;
          label: string;
          description?: string;
          enabled?: boolean;
        };
        items.push({
          key: entry.key.trim(),
          label: entry.label.trim(),
          description: entry.description,
          enabled: entry.enabled !== false,
          source,
        });
      }
    }
    return items;
  }

  private mergeFeatureLists(
    planFeatures: PackageFeatureItem[],
    addonFeatures: PackageFeatureItem[],
  ): PackageFeatureItem[] {
    const byKey = new Map<string, PackageFeatureItem>();
    for (const f of planFeatures) {
      byKey.set(f.key, f);
    }
    for (const f of addonFeatures) {
      const existing = byKey.get(f.key);
      if (!existing || (!existing.enabled && f.enabled)) {
        byKey.set(f.key, f);
      }
    }
    return Array.from(byKey.values());
  }

  /**
   * Retrieves the organization's active subscription and calculates
   * effective limits including plan baselines + paid add-on packs.
   */
  async getEffectiveLimits(organizationId: string): Promise<EffectivePlanLimits> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: {
        plan: true,
        addons: {
          where: { isActive: true },
          include: { addonPack: true },
        },
      },
    });

    if (!subscription || !subscription.plan) {
      // Fallback: If no subscription exists yet, fetch ENTERPRISE baseline so operations do not break
      const enterprise = await this.prisma.plan.findUnique({
        where: { code: 'ENTERPRISE' },
      });
      if (enterprise) {
        return {
          planName: enterprise.name,
          planTier: enterprise.tier,
          priceUsd: Number(enterprise.priceUsd),
          priceWithVatUsd: Number(enterprise.priceWithVatUsd),
          maxBranches: enterprise.maxBranches,
          maxInternalUsers: enterprise.maxInternalUsers,
          monthlyEmailLimit: enterprise.monthlyEmailLimit,
          monthlyWhatsAppBills: enterprise.monthlyWhatsAppBills,
          monthlyWhatsAppMarketing: enterprise.monthlyWhatsAppMarketing,
          monthlyAiRequests: enterprise.monthlyAiRequests,
          multiBranchEnabled: enterprise.multiBranchEnabled,
          emailEnabled: enterprise.emailEnabled,
          whatsAppBillsEnabled: enterprise.whatsAppBillsEnabled,
          whatsAppMarketingEnabled: enterprise.whatsAppMarketingEnabled,
          aiEnabled: enterprise.aiEnabled,
          features: this.parseFeatures(enterprise.features, 'PLAN'),
        };
      }
      throw new NotFoundException(
        `No subscription found for organization: ${organizationId}`,
      );
    }

    const { plan } = subscription;
    const planFeatures = this.parseFeatures(plan.features, 'PLAN');
    const addonFeatures: PackageFeatureItem[] = [];
    for (const addon of subscription.addons) {
      // Prefer live catalog features if linked so editing an add-on propagates immediately
      const rawAddonFeatures = addon.addonPack?.features ?? addon.features;
      addonFeatures.push(...this.parseFeatures(rawAddonFeatures, 'ADDON'));
    }

    return {
      planName: plan.name,
      planTier: plan.tier,
      priceUsd: Number(plan.priceUsd),
      priceWithVatUsd: Number(plan.priceWithVatUsd),
      maxBranches: plan.maxBranches + subscription.extraBranches,
      maxInternalUsers: plan.maxInternalUsers,
      monthlyEmailLimit: plan.monthlyEmailLimit + subscription.extraEmailLimit,
      monthlyWhatsAppBills: plan.monthlyWhatsAppBills + subscription.extraWhatsAppBills,
      monthlyWhatsAppMarketing: plan.monthlyWhatsAppMarketing + subscription.extraWhatsAppMarketing,
      monthlyAiRequests: plan.monthlyAiRequests + subscription.extraAiRequests,
      multiBranchEnabled: plan.multiBranchEnabled || subscription.extraBranches > 0,
      emailEnabled: plan.emailEnabled || subscription.extraEmailLimit > 0,
      whatsAppBillsEnabled: plan.whatsAppBillsEnabled || subscription.extraWhatsAppBills > 0,
      whatsAppMarketingEnabled: plan.whatsAppMarketingEnabled || subscription.extraWhatsAppMarketing > 0,
      aiEnabled: plan.aiEnabled || subscription.extraAiRequests > 0,
      features: this.mergeFeatureLists(planFeatures, addonFeatures),
    };
  }

  /**
   * Checks whether an organization has an enabled feature via its Plan or active Add-on packs.
   */
  async hasFeature(organizationId: string, featureKey: string): Promise<boolean> {
    const limits = await this.getEffectiveLimits(organizationId);
    return limits.features.some((f) => f.key === featureKey && f.enabled);
  }

  /**
   * Retrieves or initializes the current calendar month usage record for a tenant.
   */
  async getOrCreateCurrentUsage(organizationId: string) {
    const now = new Date();
    const periodYear = now.getUTCFullYear();
    const periodMonth = now.getUTCMonth() + 1;

    return this.prisma.organizationUsage.upsert({
      where: {
        organizationId_periodYear_periodMonth: {
          organizationId,
          periodYear,
          periodMonth,
        },
      },
      update: {},
      create: {
        organizationId,
        periodYear,
        periodMonth,
      },
    });
  }

  /**
   * Validates if the organization can create another branch.
   */
  async checkBranchCreationAllowed(organizationId: string): Promise<void> {
    const limits = await this.getEffectiveLimits(organizationId);
    const branchCount = await this.prisma.branch.count({
      where: { organizationId, status: 'ACTIVE' },
    });

    if (branchCount >= limits.maxBranches) {
      throw new ForbiddenException(
        `Branch limit reached. Your ${limits.planName} allows a maximum of ${limits.maxBranches} branches. Upgrade to Professional/Enterprise or purchase an Additional Branch add-on ($25.00/mo).`,
      );
    }
  }

  /**
   * Validates if the organization can invite or create another internal user.
   */
  async checkUserCreationAllowed(organizationId: string): Promise<void> {
    const limits = await this.getEffectiveLimits(organizationId);
    const userCount = await this.prisma.organizationUser.count({
      where: { organizationId },
    });

    if (userCount >= limits.maxInternalUsers) {
      throw new ForbiddenException(
        `User limit reached. Your ${limits.planName} allows a maximum of ${limits.maxInternalUsers} internal users. Upgrade your plan to add more staff.`,
      );
    }
  }

  /**
   * Checks WhatsApp bill allowance.
   * GUARANTEE: Does NOT throw on sale checkout — returns a clean status object.
   */
  async canSendWhatsAppBill(
    organizationId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const limits = await this.getEffectiveLimits(organizationId);
      if (!limits.whatsAppBillsEnabled) {
        return {
          allowed: false,
          reason: `WhatsApp bills are not included in ${limits.planName}. Upgrade to Professional or Enterprise to enable WhatsApp digital receipts.`,
        };
      }

      const usage = await this.getOrCreateCurrentUsage(organizationId);
      if (usage.whatsAppBillsSent >= limits.monthlyWhatsAppBills) {
        return {
          allowed: false,
          reason: `Monthly WhatsApp bill allowance (${limits.monthlyWhatsAppBills}) reached. Purchase a WhatsApp Bills add-on pack ($5.00 / 1,000 messages) or upgrade your plan.`,
        };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error(`Error checking WhatsApp bill quota: ${error}`);
      return { allowed: false, reason: 'Failed to verify quota.' };
    }
  }

  /**
   * Increments the WhatsApp bill count.
   */
  async recordWhatsAppBillSent(organizationId: string): Promise<void> {
    const now = new Date();
    const periodYear = now.getUTCFullYear();
    const periodMonth = now.getUTCMonth() + 1;

    await this.prisma.organizationUsage.upsert({
      where: {
        organizationId_periodYear_periodMonth: {
          organizationId,
          periodYear,
          periodMonth,
        },
      },
      update: {
        whatsAppBillsSent: { increment: 1 },
      },
      create: {
        organizationId,
        periodYear,
        periodMonth,
        whatsAppBillsSent: 1,
      },
    });
  }

  /**
   * Checks WhatsApp marketing broadcast allowance.
   */
  async checkWhatsAppMarketingAllowed(
    organizationId: string,
    recipientCount: number,
  ): Promise<void> {
    const limits = await this.getEffectiveLimits(organizationId);
    if (!limits.whatsAppMarketingEnabled) {
      throw new ForbiddenException(
        `WhatsApp marketing broadcasts are not included in ${limits.planName}. Upgrade to Professional or Enterprise.`,
      );
    }

    const usage = await this.getOrCreateCurrentUsage(organizationId);
    const available = limits.monthlyWhatsAppMarketing - usage.whatsAppMarketingSent;
    if (recipientCount > available) {
      throw new ForbiddenException(
        `Marketing quota exceeded. Attempting to send ${recipientCount} messages but only ${Math.max(0, available)} remaining out of ${limits.monthlyWhatsAppMarketing} this month.`,
      );
    }
  }

  /**
   * Increments WhatsApp marketing messages count.
   */
  async recordWhatsAppMarketingSent(
    organizationId: string,
    count: number,
  ): Promise<void> {
    const now = new Date();
    const periodYear = now.getUTCFullYear();
    const periodMonth = now.getUTCMonth() + 1;

    await this.prisma.organizationUsage.upsert({
      where: {
        organizationId_periodYear_periodMonth: {
          organizationId,
          periodYear,
          periodMonth,
        },
      },
      update: {
        whatsAppMarketingSent: { increment: count },
      },
      create: {
        organizationId,
        periodYear,
        periodMonth,
        whatsAppMarketingSent: count,
      },
    });
  }

  /**
   * Checks transactional email allowance.
   */
  async canSendEmail(
    organizationId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const limits = await this.getEffectiveLimits(organizationId);
      if (!limits.emailEnabled) {
        return {
          allowed: false,
          reason: `Automated transactional emails are not included in ${limits.planName}. Upgrade to Standard, Professional, or Enterprise.`,
        };
      }

      const usage = await this.getOrCreateCurrentUsage(organizationId);
      if (usage.emailsSent >= limits.monthlyEmailLimit) {
        return {
          allowed: false,
          reason: `Monthly email limit (${limits.monthlyEmailLimit}) reached. Upgrade or purchase an Email add-on pack.`,
        };
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'Failed to verify email quota.' };
    }
  }

  /**
   * Increments sent emails count.
   */
  async recordEmailSent(organizationId: string): Promise<void> {
    const now = new Date();
    const periodYear = now.getUTCFullYear();
    const periodMonth = now.getUTCMonth() + 1;

    await this.prisma.organizationUsage.upsert({
      where: {
        organizationId_periodYear_periodMonth: {
          organizationId,
          periodYear,
          periodMonth,
        },
      },
      update: {
        emailsSent: { increment: 1 },
      },
      create: {
        organizationId,
        periodYear,
        periodMonth,
        emailsSent: 1,
      },
    });
  }

  /**
   * Checks Gemini AI request allowance.
   */
  async checkAiRequestAllowed(organizationId: string): Promise<void> {
    const limits = await this.getEffectiveLimits(organizationId);
    if (!limits.aiEnabled) {
      throw new ForbiddenException(
        `Gemini AI assistant and forecasting features are not included in ${limits.planName}. Upgrade to Professional or Enterprise (or purchase the Standard AI add-on for $15.00/1,000 requests).`,
      );
    }

    const usage = await this.getOrCreateCurrentUsage(organizationId);
    if (usage.aiRequestsUsed >= limits.monthlyAiRequests) {
      throw new ForbiddenException(
        `Monthly Gemini AI request allowance (${limits.monthlyAiRequests}) exhausted. Purchase an AI Add-on Pack ($8.00 / 500 requests or $15.00 / 1,000 requests) to continue.`,
      );
    }
  }

  /**
   * Increments AI requests count.
   */
  async recordAiRequestUsed(organizationId: string): Promise<void> {
    const now = new Date();
    const periodYear = now.getUTCFullYear();
    const periodMonth = now.getUTCMonth() + 1;

    await this.prisma.organizationUsage.upsert({
      where: {
        organizationId_periodYear_periodMonth: {
          organizationId,
          periodYear,
          periodMonth,
        },
      },
      update: {
        aiRequestsUsed: { increment: 1 },
      },
      create: {
        organizationId,
        periodYear,
        periodMonth,
        aiRequestsUsed: 1,
      },
    });
  }

  /**
   * Compiles the full usage dashboard for the tenant or platform admin.
   */
  async getUsageOverview(organizationId: string): Promise<UsageOverview> {
    const limits = await this.getEffectiveLimits(organizationId);
    const usage = await this.getOrCreateCurrentUsage(organizationId);

    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    const branchCount = await this.prisma.branch.count({
      where: { organizationId, status: 'ACTIVE' },
    });

    const userCount = await this.prisma.organizationUser.count({
      where: { organizationId },
    });

    const formatMetric = (used: number, limit: number, enabled: boolean): MetricUsage => {
      const remaining = Math.max(0, limit - used);
      const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
      return { used, limit, remaining, percent, enabled };
    };

    return {
      plan: {
        tier: limits.planTier,
        name: limits.planName,
        priceUsd: limits.priceUsd,
        priceWithVatUsd: limits.priceWithVatUsd,
        status: subscription?.status ?? 'ACTIVE',
        currentPeriodEnd: subscription?.currentPeriodEnd ?? new Date(),
      },
      features: limits.features,
      metrics: {
        branches: formatMetric(branchCount, limits.maxBranches, true),
        users: formatMetric(userCount, limits.maxInternalUsers, true),
        transactionalEmails: formatMetric(
          usage.emailsSent,
          limits.monthlyEmailLimit,
          limits.emailEnabled,
        ),
        whatsAppBills: formatMetric(
          usage.whatsAppBillsSent,
          limits.monthlyWhatsAppBills,
          limits.whatsAppBillsEnabled,
        ),
        whatsAppMarketing: formatMetric(
          usage.whatsAppMarketingSent,
          limits.monthlyWhatsAppMarketing,
          limits.whatsAppMarketingEnabled,
        ),
        aiRequests: formatMetric(
          usage.aiRequestsUsed,
          limits.monthlyAiRequests,
          limits.aiEnabled,
        ),
      },
    };
  }
}
