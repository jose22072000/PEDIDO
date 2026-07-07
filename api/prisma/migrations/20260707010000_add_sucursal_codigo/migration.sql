-- AlterTable
ALTER TABLE "Sucursal" ADD COLUMN "codigo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sucursal_codigo_key" ON "Sucursal"("codigo");
