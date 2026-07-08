-- Baja del vendedor (soft delete). Al botar a un vendedor se pone activo=false:
-- deja de aceptarse su CSV y desaparece de las listas, pero se CONSERVA todo su
-- histórico de pedidos (reportes y analitics siguen cuadrando).
ALTER TABLE "Seller" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
