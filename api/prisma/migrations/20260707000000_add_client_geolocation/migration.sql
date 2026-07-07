-- AlterTable (SQLite)
ALTER TABLE "Client" ADD COLUMN "direccion" TEXT;
ALTER TABLE "Client" ADD COLUMN "municipio" TEXT;
ALTER TABLE "Client" ADD COLUMN "clientType" TEXT;
ALTER TABLE "Client" ADD COLUMN "purchaseStatus" TEXT;
ALTER TABLE "Client" ADD COLUMN "latitud" REAL;
ALTER TABLE "Client" ADD COLUMN "longitud" REAL;
ALTER TABLE "Client" ADD COLUMN "geoRaw" TEXT;
