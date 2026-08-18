-- Palma Soriano y Moa: dos sucursales nuevas.
--
-- El código de tres letras es el que cruza con el Consolidado y con `Branch.externalId`
-- de delivery, así que se elige aquí y no se improvisa después: PAL y MOA.
--
-- Van en migración y no a mano en la base para que existan igual en todos los entornos
-- y al desplegar, en vez de depender de que alguien las cree en cada sitio.
--
-- ON CONFLICT sobre el código: si ya estuvieran, no se duplican.
INSERT INTO "Sucursal" ("id", "nombre", "codigo", "createdAt")
VALUES
    (replace(gen_random_uuid()::text, '-', ''), 'Palma Soriano', 'PAL', now()),
    (replace(gen_random_uuid()::text, '-', ''), 'Moa',           'MOA', now())
ON CONFLICT ("codigo") DO NOTHING;
