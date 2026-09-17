-- Quién puso `requiresDelivery` en true: nosotros, al entrar un costo de la APK.
--
-- Desde el 15/09/2026 un costo que llega marca el pedido como de domicilio. Al cancelarse
-- esa entrega hay que decidir si el pedido vuelve a «sin domicilio» o si siempre lo llevó
-- y sólo se cayó este reparto. Sin este dato las dos cosas se ven igual.
--
-- Nulo en todo lo anterior: «no se sabe», que no es «no fuimos nosotros». Una cancelación
-- sobre un pedido viejo no revierte la bandera, que es el lado prudente: dejar un pedido
-- de domicilio sin marcar lo saca de las rutas.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFlagFromApk" BOOLEAN;
