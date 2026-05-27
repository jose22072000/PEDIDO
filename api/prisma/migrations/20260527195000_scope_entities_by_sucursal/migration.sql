-- Add sucursal scoping columns
ALTER TABLE "Seller" ADD COLUMN "sucursalId" TEXT;
ALTER TABLE "Client" ADD COLUMN "sucursalId" TEXT;
ALTER TABLE "Order" ADD COLUMN "sucursalId" TEXT;

-- Replace global unique constraints with per-sucursal unique constraints
DROP INDEX IF EXISTS "Seller_name_key";
DROP INDEX IF EXISTS "Seller_code_key";
DROP INDEX IF EXISTS "Client_parrandaId_key";
DROP INDEX IF EXISTS "Order_folio_sellerId_key";

CREATE UNIQUE INDEX "Seller_sucursalId_name_key" ON "Seller"("sucursalId", "name");
CREATE UNIQUE INDEX "Seller_sucursalId_code_key" ON "Seller"("sucursalId", "code");
CREATE UNIQUE INDEX "Client_sucursalId_parrandaId_key" ON "Client"("sucursalId", "parrandaId");
CREATE UNIQUE INDEX "Order_sucursalId_folio_sellerId_key" ON "Order"("sucursalId", "folio", "sellerId");
