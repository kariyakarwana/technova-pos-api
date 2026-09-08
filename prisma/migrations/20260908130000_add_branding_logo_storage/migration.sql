ALTER TABLE "branding_assets"
ADD COLUMN "logoObjectKey" TEXT,
ADD COLUMN "logoBucket" TEXT,
ADD COLUMN "logoContentType" TEXT,
ADD COLUMN "logoSizeBytes" INTEGER;

CREATE UNIQUE INDEX "branding_assets_logoObjectKey_key" ON "branding_assets"("logoObjectKey");
