-- Configurable loyalty earning/redemption rules and auditable sale redemptions.
ALTER TABLE "sales"
ADD COLUMN "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "loyaltyRedemptionValue" DECIMAL(18,2) NOT NULL DEFAULT 0;

CREATE TABLE "loyalty_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spendAmount" DECIMAL(18,2) NOT NULL,
    "pointsAwarded" INTEGER NOT NULL,
    "redemptionValuePerPoint" DECIMAL(18,2) NOT NULL DEFAULT 1,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loyalty_rules_organizationId_status_idx"
ON "loyalty_rules"("organizationId", "status");

ALTER TABLE "loyalty_rules"
ADD CONSTRAINT "loyalty_rules_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
