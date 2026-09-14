ALTER TABLE "customers" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");

ALTER TABLE "customers"
ADD CONSTRAINT "customers_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
