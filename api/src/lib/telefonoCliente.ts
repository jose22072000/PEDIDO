import prisma from '../prismaClient';

/**
 * Rellena el teléfono del CLIENTE con el del pedido más reciente que traiga uno.
 *
 * # Por qué hacía falta
 *
 * El teléfono sólo se guardaba en el pedido. Eso significa que la ficha del cliente
 * nunca lo tuvo, y para saber si teníamos el número de alguien había que abrir sus
 * pedidos uno a uno. Para el cliente que llevaba meses sin comprar, la respuesta
 * práctica era "no lo tenemos" — cuando sí lo teníamos, sólo que enterrado.
 *
 * # Por qué el más reciente
 *
 * Porque un cliente cambia de número, y el último que dio es el que contesta. Coger
 * el más antiguo dejaría fijado para siempre un teléfono que ya no existe.
 *
 * Sólo rellena lo que está vacío. Un teléfono corregido a mano en la ficha no se pisa:
 * quien lo escribió sabía más que el pedido de hace ocho meses.
 */
export async function rellenarTelefonos(): Promise<number> {
  // Se hace en SQL y no en JS a propósito: son decenas de miles de pedidos, y traerlos
  // para recorrerlos aquí es cargar en memoria una tabla entera para usar un campo.
  const filas = await prisma.$executeRaw`
    UPDATE "Client" c
    SET telefono = p.telefono
    FROM (
      SELECT DISTINCT ON ("clientId") "clientId", telefono
      FROM "Order"
      WHERE "clientId" IS NOT NULL
        AND telefono IS NOT NULL
        AND btrim(telefono) <> ''
      ORDER BY "clientId", fecha DESC
    ) p
    WHERE p."clientId" = c.id
      AND (c.telefono IS NULL OR btrim(c.telefono) = '')
  `;
  return filas;
}

/**
 * Al arrancar y una vez al día.
 *
 * Al arrancar recupera lo que ya existía; el repaso diario coge a los clientes que
 * estrenaron teléfono en un pedido nuevo. No hace falta más: un teléfono que aparece
 * hoy no es urgente esta misma hora, y así no se le añade trabajo constante al worker.
 */
export function arrancarTelefonos(): void {
  const correr = () => {
    rellenarTelefonos()
      .then((n) => { if (n > 0) console.log(`[telefonos] ${n} clientes estrenan teléfono desde sus pedidos`); })
      .catch((e) => console.error('[telefonos] fallo al rellenar:', e));
  };
  correr();
  setInterval(correr, 24 * 60 * 60 * 1000).unref();
}
