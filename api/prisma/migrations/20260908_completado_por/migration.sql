-- Quién completó el pedido.
--
-- Sólo se guardaba `completedAt` —el cuándo—. Completar es decir «esto ya se facturó», así
-- que cuando aparece un pedido completado sin factura hay que poder preguntarle a alguien.
--
-- El nombre va COPIADO y no por relación: los usuarios se borran, y con una relación el
-- nombre desaparecería justo de los pedidos viejos, que son los que se van a revisar. Un id
-- huérfano no le dice nada a nadie.
--
-- Los pedidos ya completados se quedan con los dos campos en NULO: no hay de dónde sacar
-- quién fue. La pantalla lo dirá como «no se guardó» y no como «nadie», que son cosas
-- distintas.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "completadoPorId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "completadoPor" TEXT;
