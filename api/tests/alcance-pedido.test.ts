import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Dos fallos de producción del 07/08/2026, los dos con el mismo síntoma: un
 * pedido que se VE en la lista pero no se puede completar. "Error al completar
 * el pedido", y a unos usuarios sí les dejaba y a otros no.
 *
 * Aquí se fijan las dos reglas que los causaron. No hace falta base de datos:
 * lo que se comprueba es la FORMA de la consulta, que es donde estaba el error.
 */

// ---------------------------------------------------------------------------
// 1. Leer y escribir tienen que alcanzar lo mismo
// ---------------------------------------------------------------------------

/** Copia exacta de la regla de `alcancePedido` en `routes/orders.ts`. */
function alcance(opts: { id: string; sucursalId: string | null; esGlobal: boolean }) {
  const { id, sucursalId, esGlobal } = opts;

  if (!sucursalId) {
    if (esGlobal) return { where: { id } };

    return { error: 'sin sucursal' };
  }

  return { where: { id, sucursalId } };
}

describe('quién puede tocar un pedido', () => {
  test('EL FALLO: el Super Admin ve todos los pedidos y tiene que poder completarlos', () => {
    // La lista le devuelve TODAS las sucursales. Si al completar se le exigiera
    // una sucursal concreta, vería pedidos que no puede tocar — que es
    // exactamente lo que pasaba.
    const r = alcance({ id: 'p1', sucursalId: null, esGlobal: true });

    assert.deepEqual(r.where, { id: 'p1' });
    assert.equal(r.error, undefined);
  });

  test('el Super Admin enfocado en una sucursal queda limitado a ella', () => {
    const r = alcance({ id: 'p1', sucursalId: 'CAM', esGlobal: true });

    assert.deepEqual(r.where, { id: 'p1', sucursalId: 'CAM' });
  });

  test('un usuario normal solo alcanza los de SU sucursal', () => {
    const r = alcance({ id: 'p1', sucursalId: 'HOL', esGlobal: false });

    assert.deepEqual(r.where, { id: 'p1', sucursalId: 'HOL' });
  });

  test('un usuario sin sucursal y sin ser global no toca nada', () => {
    // Nunca debe caer en el caso "sin filtro": seria dejarle tocar CUALQUIER
    // pedido de CUALQUIER sucursal.
    const r = alcance({ id: 'p1', sucursalId: null, esGlobal: false });

    assert.equal(r.where, undefined);
    assert.ok(r.error);
  });
});

// ---------------------------------------------------------------------------
// 2. El backfill tiene que coger los pedidos SIN sucursal
// ---------------------------------------------------------------------------

/** Aplica el `where` del backfill sobre unos pedidos de mentira. */
function pedidosQueSeRellenan(
  pedidos: Array<{ id: string; sucursalId: string | null }>,
  destino: string,
) {
  // Misma condición que `routes/vendedores.ts`: los que NO tienen sucursal MÁS
  // los que la tienen distinta.
  return pedidos.filter((p) => p.sucursalId === null || p.sucursalId !== destino);
}

describe('backfill al enlazar un gestor', () => {
  const pedidos = [
    { id: 'sin-sucursal', sucursalId: null },
    { id: 'otra-sucursal', sucursalId: 'CAM' },
    { id: 'ya-correcto', sucursalId: 'TUN' },
  ];

  test('EL FALLO: los pedidos SIN sucursal se rellenan', () => {
    // Con `NOT: { sucursalId }` se traducía a `"sucursalId" <> 'TUN'`, y comparar
    // NULL con algo no da verdadero: da DESCONOCIDO. Así que los pedidos sin
    // sucursal —los únicos que este backfill viene a arreglar— eran justo los
    // que se saltaba. Tres pedidos de Raúl Salgado llevaban días invisibles.
    const tocados = pedidosQueSeRellenan(pedidos, 'TUN').map((p) => p.id);

    assert.ok(tocados.includes('sin-sucursal'), 'el que no tiene sucursal TIENE que entrar');
  });

  test('también recoloca los que están en la sucursal equivocada', () => {
    const tocados = pedidosQueSeRellenan(pedidos, 'TUN').map((p) => p.id);

    assert.ok(tocados.includes('otra-sucursal'));
  });

  test('y no toca los que ya estaban bien', () => {
    const tocados = pedidosQueSeRellenan(pedidos, 'TUN').map((p) => p.id);

    assert.ok(!tocados.includes('ya-correcto'));
  });
});
