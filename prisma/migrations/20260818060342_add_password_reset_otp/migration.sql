-- AlterTable
ALTER TABLE "security_tokens" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpHash" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);
