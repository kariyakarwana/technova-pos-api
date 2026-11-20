-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('BASIC', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SmtpProviderType" AS ENUM ('PLATFORM_DEFAULT', 'TENANT_CUSTOM_SMTP', 'CLOUD_API');

-- CreateEnum
CREATE TYPE "AddonQuotaTarget" AS ENUM ('BRANCHES', 'WHATSAPP_BILLS', 'WHATSAPP_MARKETING', 'EMAILS', 'AI_REQUESTS', 'CUSTOM_FEATURE');

-- CreateEnum
CREATE TYPE "SubscriptionRequestType" AS ENUM ('PLAN_CHANGE', 'ADDON_PACK');

-- CreateEnum
CREATE TYPE "SubscriptionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropIndex
DROP INDEX "roles_name_key";

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'GLOBAL';

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL DEFAULT 'CUSTOM',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceUsd" DECIMAL(10,2) NOT NULL,
    "vatRate" DECIMAL(5,4) NOT NULL DEFAULT 0.18,
    "priceWithVatUsd" DECIMAL(10,2) NOT NULL,
    "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxBranches" INTEGER NOT NULL DEFAULT 1,
    "maxInternalUsers" INTEGER NOT NULL DEFAULT 10,
    "monthlyEmailLimit" INTEGER NOT NULL DEFAULT 0,
    "monthlyWhatsAppBills" INTEGER NOT NULL DEFAULT 0,
    "monthlyWhatsAppMarketing" INTEGER NOT NULL DEFAULT 0,
    "monthlyAiRequests" INTEGER NOT NULL DEFAULT 0,
    "multiBranchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsAppBillsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsAppMarketingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_packs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quotaTarget" "AddonQuotaTarget" NOT NULL DEFAULT 'CUSTOM_FEATURE',
    "unitsPerPack" INTEGER NOT NULL DEFAULT 0,
    "priceUsd" DECIMAL(10,2) NOT NULL,
    "billingCycle" TEXT NOT NULL DEFAULT 'ONE_TIME',
    "features" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addon_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "extraBranches" INTEGER NOT NULL DEFAULT 0,
    "extraEmailLimit" INTEGER NOT NULL DEFAULT 0,
    "extraWhatsAppBills" INTEGER NOT NULL DEFAULT 0,
    "extraWhatsAppMarketing" INTEGER NOT NULL DEFAULT 0,
    "extraAiRequests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_addons" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "addonPackId" TEXT,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grantedUnits" INTEGER NOT NULL DEFAULT 0,
    "priceUsd" DECIMAL(10,2) NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billingPeriodKey" TEXT,
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "subtotalUsd" DECIMAL(10,2) NOT NULL,
    "vatAmountUsd" DECIMAL(10,2) NOT NULL,
    "totalAmountUsd" DECIMAL(10,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "issuedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT DEFAULT 'BANK_TRANSFER',
    "paymentRef" TEXT,
    "notes" TEXT,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_usages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "whatsAppBillsSent" INTEGER NOT NULL DEFAULT 0,
    "whatsAppMarketingSent" INTEGER NOT NULL DEFAULT 0,
    "aiRequestsUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_email_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerType" "SmtpProviderType" NOT NULL DEFAULT 'PLATFORM_DEFAULT',
    "smtpHost" TEXT,
    "smtpPort" INTEGER DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "fromEmail" TEXT,
    "fromName" TEXT,
    "apiKey" TEXT,
    "apiRegion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_email_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "requestedById" TEXT,
    "type" "SubscriptionRequestType" NOT NULL,
    "status" "SubscriptionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "targetPlanCode" TEXT,
    "addonCode" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "paymentRef" TEXT,
    "reviewNotes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "addon_packs_code_key" ON "addon_packs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "subscription_addons_subscriptionId_idx" ON "subscription_addons"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_addons_addonPackId_idx" ON "subscription_addons"("addonPackId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_invoiceNumber_key" ON "subscription_invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_billingPeriodKey_key" ON "subscription_invoices"("billingPeriodKey");

-- CreateIndex
CREATE INDEX "subscription_invoices_subscriptionId_status_idx" ON "subscription_invoices"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "organization_usages_organizationId_idx" ON "organization_usages"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_usages_organizationId_periodYear_periodMonth_key" ON "organization_usages"("organizationId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_email_configs_organizationId_key" ON "tenant_email_configs"("organizationId");

-- CreateIndex
CREATE INDEX "subscription_requests_organizationId_status_idx" ON "subscription_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "subscription_requests_type_status_idx" ON "subscription_requests"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_scope_name_key" ON "roles"("scope", "name");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_addons" ADD CONSTRAINT "subscription_addons_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_addons" ADD CONSTRAINT "subscription_addons_addonPackId_fkey" FOREIGN KEY ("addonPackId") REFERENCES "addon_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_usages" ADD CONSTRAINT "organization_usages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_email_configs" ADD CONSTRAINT "tenant_email_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
