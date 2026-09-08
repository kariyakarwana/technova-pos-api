ALTER TABLE "product_images"
ADD COLUMN "objectKey" TEXT,
ADD COLUMN "bucket" TEXT,
ADD COLUMN "contentType" TEXT,
ADD COLUMN "sizeBytes" INTEGER,
ADD COLUMN "originalName" TEXT;

CREATE UNIQUE INDEX "product_images_objectKey_key" ON "product_images"("objectKey");

CREATE TABLE "product_videos" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "objectKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_videos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_videos_objectKey_key" ON "product_videos"("objectKey");
CREATE UNIQUE INDEX "product_videos_productId_key" ON "product_videos"("productId");

ALTER TABLE "product_videos" ADD CONSTRAINT "product_videos_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
