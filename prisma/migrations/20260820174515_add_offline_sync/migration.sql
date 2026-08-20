-- CreateEnum
CREATE TYPE "SyncBatchStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncOperationStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "offline_sync_batches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientBatchId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" "SyncBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "offline_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_operations" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "clientOperationId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "clientTimestamp" TIMESTAMP(3) NOT NULL,
    "status" "SyncOperationStatus" NOT NULL DEFAULT 'PENDING',
    "response" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offline_sync_batches_clientBatchId_key" ON "offline_sync_batches"("clientBatchId");

-- CreateIndex
CREATE INDEX "offline_sync_batches_userId_receivedAt_idx" ON "offline_sync_batches"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "offline_sync_batches_deviceId_receivedAt_idx" ON "offline_sync_batches"("deviceId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "offline_sync_operations_clientOperationId_key" ON "offline_sync_operations"("clientOperationId");

-- CreateIndex
CREATE INDEX "offline_sync_operations_batchId_status_idx" ON "offline_sync_operations"("batchId", "status");

-- CreateIndex
CREATE INDEX "offline_sync_operations_clientTimestamp_idx" ON "offline_sync_operations"("clientTimestamp");

-- AddForeignKey
ALTER TABLE "offline_sync_batches" ADD CONSTRAINT "offline_sync_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_operations" ADD CONSTRAINT "offline_sync_operations_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "offline_sync_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
