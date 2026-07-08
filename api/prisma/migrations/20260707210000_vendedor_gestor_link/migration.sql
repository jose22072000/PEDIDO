-- Enlace Vendedor -> Gestor (Usuario con rol "Gestor").
-- NULL = "Sin asignar": los pedidos de ese vendedor quedan ocultos hasta enlazarlo.
ALTER TABLE "Seller" ADD COLUMN "gestorId" TEXT;

-- El código del vendedor (ej. "andy.almanza") pasa a ser ÚNICO GLOBAL: el CSV
-- identifica al vendedor sin traer la sucursal. Si el código ya existe con otro
-- nombre, es otra persona -> el import rechaza el archivo (colisión).
DROP INDEX IF EXISTS "Seller_sucursalId_code_key";
CREATE UNIQUE INDEX "Seller_code_key" ON "Seller"("code");

-- Índice para listar/filtrar por gestor y para el bucket "Sin asignar".
CREATE INDEX "Seller_gestorId_idx" ON "Seller"("gestorId");
