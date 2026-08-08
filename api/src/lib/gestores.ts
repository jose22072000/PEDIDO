import type { Prisma } from '@prisma/client';

// Roles que pueden "llevar" vendedores (ser su gestor). Un vendedor SIN enlace queda
// "sin asignar" y sus pedidos NO aparecen en la vista (que scopea por la sucursal del
// gestor). El Supervisor también sube pedidos, así que también tiene que poder llevarlos.
export const ROLES_ENLAZABLES = ['Gestor', 'Supervisor'];

export type ResultadoBackfill = {
  pedidos: number;
  clientes: number;
  /** Huérfanos que ya existían en la sucursal: se unificaron con el que estaba. */
  fusionados: number;
};

/**
 * Mete los pedidos y clientes de un vendedor en la sucursal que le corresponde.
 *
 * Vive aquí y no dentro de una ruta porque lo necesitan dos sitios: enlazar un
 * gestor (PATCH /vendedores/:id/gestor) y reasignar los vendedores de un usuario
 * antes de borrarlo (POST /users/:id/reasignar-vendedores). Duplicarlo llevaría a
 * que uno de los dos se quedara atrás y volviesen los pedidos invisibles.
 *
 * Se llama SIEMPRE dentro de una transacción: si algo falla, no puede quedar la
 * mitad de los pedidos en una sucursal y la otra mitad fuera.
 */
export async function backfillSucursalDeVendedor(
  tx: Prisma.TransactionClient,
  vendedorId: string,
  sucursalId: string,
): Promise<ResultadoBackfill> {
  // TODOS sus pedidos, no solo los que estaban en null. Si el vendedor arrastraba
  // pedidos en la sucursal equivocada (heredada del que subió el CSV), esto los
  // recoloca donde de verdad van.
  //
  // El `sucursalId: null` va EXPLÍCITO y no se puede quitar. Antes esto era
  // `NOT: { sucursalId }`, que en SQL se traduce a `"sucursalId" <> 'X'` — y comparar
  // NULL con algo no da verdadero, da DESCONOCIDO. Resultado: los pedidos sin
  // sucursal, que son justo los que este backfill viene a arreglar, eran los únicos
  // que se saltaba, y quedaban invisibles e imposibles de completar sin que nada avisara.
  const p = await tx.pedido.updateMany({
    where: {
      vendedorId,
      OR: [{ sucursalId: null }, { sucursalId: { not: sucursalId } }],
    },
    data: { sucursalId },
  });

  const clienteIds = (
    await tx.pedido.findMany({ where: { vendedorId }, select: { clienteId: true } })
  )
    .map((x) => x.clienteId)
    .filter((x): x is string => !!x);

  let clientes = 0;
  let fusionados = 0;

  if (clienteIds.length) {
    // En clientes solo se tocan los huérfanos: un cliente puede comprarle a
    // vendedores de más de una sucursal, así que no se le pisa la suya.
    //
    // Rellenarles la sucursal a ciegas NO vale: muchos de esos huérfanos YA existen
    // en la sucursal destino porque son la misma persona, creada por otro vendedor
    // que sí tenía gestor. Al ponerles la misma sucursal chocaban contra los únicos
    // (nombre, sucursalId) y (sucursalId, codigo), y el enlace entero moría con un
    // 500 "Error al enlazar el gestor" sin decir por qué.
    //
    // Pasó el 08/08/2026 en Holguín: al borrar los usuarios que venían de Parranda
    // sus vendedores quedaron sin gestor, y de los 20 clientes huérfanos de uno de
    // ellos 19 ya estaban en la sucursal. Era imposible reasignarlo.
    const huerfanos = await tx.cliente.findMany({
      where: { id: { in: clienteIds }, sucursalId: null },
      select: { id: true, nombre: true, codigo: true },
    });

    if (huerfanos.length) {
      const codigos = huerfanos.map((h) => h.codigo).filter((c): c is string => !!c);

      const condiciones: Array<{ nombre?: { in: string[] }; codigo?: { in: string[] } }> = [
        { nombre: { in: huerfanos.map((h) => h.nombre) } },
      ];
      if (codigos.length) condiciones.push({ codigo: { in: codigos } });

      const enDestino = await tx.cliente.findMany({
        where: { sucursalId, OR: condiciones },
        select: { id: true, nombre: true, codigo: true },
      });

      const porNombre = new Map<string, string>();
      const porCodigo = new Map<string, string>();
      for (const c of enDestino) {
        porNombre.set(c.nombre, c.id);
        if (c.codigo) porCodigo.set(c.codigo, c.id);
      }

      for (const h of huerfanos) {
        // El código de Parranda identifica mejor que el nombre (dos clientes pueden
        // escribirse igual), así que se mira primero.
        const existente = (h.codigo && porCodigo.get(h.codigo)) || porNombre.get(h.nombre);

        if (existente) {
          // El cliente NO se duplica: los pedidos pasan al que ya está y la fila
          // huérfana se borra. Solo Pedido referencia a Cliente, así que repuntar y
          // borrar no deja nada colgando.
          await tx.pedido.updateMany({
            where: { clienteId: h.id },
            data: { clienteId: existente },
          });
          await tx.cliente.delete({ where: { id: h.id } });
          fusionados++;
        } else {
          await tx.cliente.update({ where: { id: h.id }, data: { sucursalId } });
          clientes++;
          // Dos huérfanos pueden llamarse igual entre ellos: el segundo tiene que
          // fusionarse con el primero, no volver a rellenar y chocar.
          porNombre.set(h.nombre, h.id);
          if (h.codigo) porCodigo.set(h.codigo, h.id);
        }
      }
    }
  }

  return { pedidos: p.count, clientes, fusionados };
}
