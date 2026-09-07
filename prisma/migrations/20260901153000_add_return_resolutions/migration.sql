CREATE TYPE "ReturnResolution" AS ENUM ('ORIGINAL_METHOD', 'STORE_CREDIT', 'LOYALTY_POINTS', 'PRODUCT_EXCHANGE');
ALTER TYPE "PaymentMethod" ADD VALUE 'STORE_CREDIT';

ALTER TABLE "returns" ADD COLUMN "resolution" "ReturnResolution" NOT NULL DEFAULT 'ORIGINAL_METHOD';
ALTER TABLE "returns" ADD COLUMN "storeCreditAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "returns" ADD COLUMN "loyaltyPointsAwarded" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "store_credit_accounts" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_credit_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_credit_accounts_customerId_key" ON "store_credit_accounts"("customerId");
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "store_credit_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "store_credit_transactions" (
  "id" TEXT NOT NULL,
  "storeCreditAccountId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_credit_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "store_credit_transactions_storeCreditAccountId_createdAt_idx" ON "store_credit_transactions"("storeCreditAccountId", "createdAt");
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_storeCreditAccountId_fkey" FOREIGN KEY ("storeCreditAccountId") REFERENCES "store_credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
