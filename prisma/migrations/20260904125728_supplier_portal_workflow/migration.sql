-- CreateEnum
CREATE TYPE "SupplierResponseStatus" AS ENUM ('ACCEPTED', 'CHANGES_PROPOSED', 'REJECTED', 'CLARIFICATION_REQUESTED');

-- CreateEnum
CREATE TYPE "SupplierResponseReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupplierShipmentStatus" AS ENUM ('PREPARING', 'DISPATCHED', 'DELIVERED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "supplierEmailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supplierInAppNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supplierOrderChangesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supplierPortalEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "allowOrderChanges" BOOLEAN,
ADD COLUMN     "emailNotificationsEnabled" BOOLEAN,
ADD COLUMN     "inAppNotificationsEnabled" BOOLEAN,
ADD COLUMN     "portalEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "supplier_users" (
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_users_pkey" PRIMARY KEY ("supplierId","userId")
);

-- CreateTable
CREATE TABLE "supplier_order_responses" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "respondedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "status" "SupplierResponseStatus" NOT NULL,
    "reviewStatus" "SupplierResponseReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "notes" TEXT,
    "proposedExpectedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_order_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_response_lines" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "proposedQuantity" DECIMAL(18,3),
    "proposedUnitCost" DECIMAL(18,2),
    "note" TEXT,

    CONSTRAINT "supplier_order_response_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_shipments" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "dispatchedById" TEXT NOT NULL,
    "status" "SupplierShipmentStatus" NOT NULL DEFAULT 'PREPARING',
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "notes" TEXT,
    "expectedArrival" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileData" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "supplierId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_users_userId_key" ON "supplier_users"("userId");

-- CreateIndex
CREATE INDEX "supplier_users_supplierId_idx" ON "supplier_users"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_order_responses_purchaseOrderId_respondedAt_idx" ON "supplier_order_responses"("purchaseOrderId", "respondedAt");

-- CreateIndex
CREATE INDEX "supplier_order_responses_reviewStatus_respondedAt_idx" ON "supplier_order_responses"("reviewStatus", "respondedAt");

-- CreateIndex
CREATE INDEX "supplier_order_response_lines_purchaseOrderItemId_idx" ON "supplier_order_response_lines"("purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_order_response_lines_responseId_purchaseOrderItemI_key" ON "supplier_order_response_lines"("responseId", "purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "supplier_shipments_purchaseOrderId_createdAt_idx" ON "supplier_shipments"("purchaseOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_shipments_status_updatedAt_idx" ON "supplier_shipments"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "supplier_invoices_purchaseOrderId_uploadedAt_idx" ON "supplier_invoices"("purchaseOrderId", "uploadedAt");

-- CreateIndex
CREATE INDEX "app_notifications_recipientUserId_readAt_createdAt_idx" ON "app_notifications"("recipientUserId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "app_notifications_organizationId_createdAt_idx" ON "app_notifications"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "supplier_users" ADD CONSTRAINT "supplier_users_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_users" ADD CONSTRAINT "supplier_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_responses" ADD CONSTRAINT "supplier_order_responses_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_responses" ADD CONSTRAINT "supplier_order_responses_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_responses" ADD CONSTRAINT "supplier_order_responses_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_response_lines" ADD CONSTRAINT "supplier_order_response_lines_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "supplier_order_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_response_lines" ADD CONSTRAINT "supplier_order_response_lines_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_shipments" ADD CONSTRAINT "supplier_shipments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_shipments" ADD CONSTRAINT "supplier_shipments_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "supplier_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
