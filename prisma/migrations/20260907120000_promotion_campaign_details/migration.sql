ALTER TABLE "discount_rules"
ADD COLUMN "code" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "promotionNotifiedAt" TIMESTAMP(3),
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "discount_rules_organizationId_code_key"
ON "discount_rules"("organizationId", "code");
