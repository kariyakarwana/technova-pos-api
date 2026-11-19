ALTER TABLE "subscriptions" ADD COLUMN "billingAnchorDay" INTEGER NOT NULL DEFAULT 1;
UPDATE "subscriptions" SET "billingAnchorDay" = EXTRACT(DAY FROM "currentPeriodStart");
ALTER TABLE "subscriptions" ADD CONSTRAINT "billing_anchor_day_range" CHECK ("billingAnchorDay" BETWEEN 1 AND 31);
ALTER TABLE "subscription_invoices" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "vatRateSnapshot" DECIMAL(10,6), ADD COLUMN "periodStart" TIMESTAMP(3),
  ADD COLUMN "periodEnd" TIMESTAMP(3), ADD COLUMN "customerSnapshot" JSONB;
-- Historic invoices retain unknown snapshot fields rather than inventing historic prices.
CREATE TABLE "subscription_usages" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "periodStart" TIMESTAMP(3) NOT NULL, "periodEnd" TIMESTAMP(3) NOT NULL,
  "emailsSent" INTEGER NOT NULL DEFAULT 0, "whatsAppBillsSent" INTEGER NOT NULL DEFAULT 0,
  "whatsAppMarketingSent" INTEGER NOT NULL DEFAULT 0, "aiRequestsUsed" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_usages_organizationId_periodStart_key" UNIQUE ("organizationId", "periodStart")
);
CREATE INDEX "subscription_usages_periodEnd_idx" ON "subscription_usages"("periodEnd");
-- Preserve legacy counters and conservatively carry overlapping calendar buckets into
-- the current subscription period. Legacy rows remain intact for operator reconciliation.
INSERT INTO "subscription_usages" ("id", "organizationId", "periodStart", "periodEnd", "emailsSent", "whatsAppBillsSent", "whatsAppMarketingSent", "aiRequestsUsed", "updatedAt")
SELECT 'migration-' || s."id", s."organizationId", s."currentPeriodStart", s."currentPeriodEnd",
 COALESCE(SUM(u."emailsSent"),0), COALESCE(SUM(u."whatsAppBillsSent"),0),
 COALESCE(SUM(u."whatsAppMarketingSent"),0), COALESCE(SUM(u."aiRequestsUsed"),0), CURRENT_TIMESTAMP
FROM "subscriptions" s LEFT JOIN "organization_usages" u ON u."organizationId"=s."organizationId"
 AND make_date(u."periodYear", u."periodMonth", 1) < s."currentPeriodEnd"
 AND make_date(u."periodYear", u."periodMonth", 1) + INTERVAL '1 month' > s."currentPeriodStart"
GROUP BY s."id";
CREATE FUNCTION protect_subscription_invoice_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."subscriptionId",NEW."invoiceNumber",NEW."billingPeriodKey",NEW."lineItems",NEW."currency",NEW."vatRateSnapshot",NEW."periodStart",NEW."periodEnd",NEW."customerSnapshot",NEW."subtotalUsd",NEW."vatAmountUsd",NEW."totalAmountUsd",NEW."issuedDate",NEW."dueDate")
 IS DISTINCT FROM ROW(OLD."subscriptionId",OLD."invoiceNumber",OLD."billingPeriodKey",OLD."lineItems",OLD."currency",OLD."vatRateSnapshot",OLD."periodStart",OLD."periodEnd",OLD."customerSnapshot",OLD."subtotalUsd",OLD."vatAmountUsd",OLD."totalAmountUsd",OLD."issuedDate",OLD."dueDate") THEN
 RAISE EXCEPTION 'Issued invoice financial snapshots are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_invoice_snapshot BEFORE UPDATE ON "subscription_invoices" FOR EACH ROW EXECUTE FUNCTION protect_subscription_invoice_snapshot();
INSERT INTO "permissions" ("id", "key", "description", "updatedAt") VALUES ('billing-view-v1','billing:view','View subscription billing', CURRENT_TIMESTAMP), ('billing-manage-v1','billing:manage','Request subscription changes', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
