-- El domicilio desglosado por grupo de productos.
--
-- `Order."deliveryCost"` sigue siendo la suma y no se toca: todo lo que hoy lee ese
-- campo funciona igual. Esto se añade al lado porque la factura no se emite una sola
-- vez —Procovar factura lo suyo y Ces lo suyo, cada una con SU línea de domicilio— y
-- con un único total no hay forma de repartirlo.
--
-- El UNIQUE (orderId, grupo) es lo que hace inofensivo el reintento: la APK reenvía
-- cada 60 s hasta que le confirmamos, y sin él cada vuelta duplicaría el desglose.
--
-- NUMERIC y no double precision: es dinero, y estas filas se suman para comprobar que
-- cuadran con el total. Con coma flotante esa comprobación fallaría por un céntimo que
-- no existe.
CREATE TABLE IF NOT EXISTS "OrderDeliveryGroup" (
    "id"        TEXT NOT NULL,
    "orderId"   TEXT NOT NULL,
    "grupo"     TEXT NOT NULL,
    "entrega"   NUMERIC(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderDeliveryGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderDeliveryGroup_orderId_grupo_key"
    ON "OrderDeliveryGroup" ("orderId", "grupo");

CREATE INDEX IF NOT EXISTS "OrderDeliveryGroup_orderId_idx"
    ON "OrderDeliveryGroup" ("orderId");

DO $$
BEGIN
    ALTER TABLE "OrderDeliveryGroup"
        ADD CONSTRAINT "OrderDeliveryGroup_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Lo que valen los PRODUCTOS de cada grupo, tal como lo manda la APK.
--
-- Nulo mientras no llegue: «no lo sabemos» no es cero. Columna y no JSON a propósito —
-- cuando el grupo trae su propio pedido, esta cifra tiene que cuadrar con la suma de las
-- líneas de ese pedido, y un blob no se puede sumar ni contrastar con nada.
ALTER TABLE "OrderDeliveryGroup" ADD COLUMN IF NOT EXISTS "productos" NUMERIC(14,2);
