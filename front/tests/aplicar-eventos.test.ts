import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { aplicarLote } from '../src/hooks/aplicar-eventos.ts';
import type { LiveEvent } from '../src/hooks/use-live-events.ts';

/**
 * Esto es lo que sustituye al "refrescar la vista entera en cada evento". Si se
 * equivoca, el usuario ve datos viejos o duplicados sin que nada falle a la vista,
 * que es la peor clase de error. De ahí que esté cubierto.
 */

type Fila = { id: string; nombre: string; sucursalId?: string | null };

const ev = (p: Partial<LiveEvent>): LiveEvent => ({
  tipo: 'vendedor',
  sucursalId: null,
  id: null,
  accion: 'update',
  ts: 0,
  ...p,
});

const LISTA: Fila[] = [
  { id: 'a', nombre: 'ANA' },
  { id: 'b', nombre: 'BETO' },
];

describe('aplicarLote', () => {
  test('sustituye en sitio y conserva el orden', () => {
    const r = aplicarLote<Fila>(LISTA, [
      ev({ id: 'b', datos: { id: 'b', nombre: 'BETO CAMBIADO' } }),
    ]);

    assert.deepEqual(r, [
      { id: 'a', nombre: 'ANA' },
      { id: 'b', nombre: 'BETO CAMBIADO' },
    ]);
  });

  test('no muta la lista original', () => {
    const original = [...LISTA];

    aplicarLote<Fila>(LISTA, [ev({ id: 'a', datos: { id: 'a', nombre: 'OTRA' } })]);
    assert.deepEqual(LISTA, original);
  });

  test('borra por id', () => {
    const r = aplicarLote<Fila>(LISTA, [ev({ id: 'a', accion: 'delete' })]);

    assert.deepEqual(r, [{ id: 'b', nombre: 'BETO' }]);
  });

  test('un evento sin objeto obliga a recargar (null)', () => {
    assert.equal(aplicarLote<Fila>(LISTA, [ev({ accion: 'bulk' })]), null);
  });

  test('basta UN evento sin objeto en la ráfaga para tener que recargar', () => {
    const r = aplicarLote<Fila>(LISTA, [
      ev({ id: 'a', datos: { id: 'a', nombre: 'X' } }),
      ev({ accion: 'bulk' }),
    ]);

    assert.equal(r, null, 'si se aplicara a medias quedarían datos inconsistentes');
  });

  test('sin alPrincipio, un elemento nuevo NO se cuela en una lista paginada', () => {
    const r = aplicarLote<Fila>(LISTA, [
      ev({ id: 'z', accion: 'create', datos: { id: 'z', nombre: 'ZOE' } }),
    ]);

    assert.deepEqual(r, LISTA, 'metería una fila que no corresponde a esta página');
  });

  test('con alPrincipio, el nuevo entra arriba', () => {
    const r = aplicarLote<Fila>(
      LISTA,
      [ev({ id: 'z', accion: 'create', datos: { id: 'z', nombre: 'ZOE' } })],
      { alPrincipio: true },
    );

    assert.equal(r?.[0].id, 'z');
    assert.equal(r?.length, 3);
  });

  test('no duplica si el elemento ya estaba (evento repetido)', () => {
    const r = aplicarLote<Fila>(
      LISTA,
      [
        ev({ id: 'a', accion: 'create', datos: { id: 'a', nombre: 'ANA' } }),
        ev({ id: 'a', accion: 'create', datos: { id: 'a', nombre: 'ANA' } }),
      ],
      { alPrincipio: true },
    );

    assert.equal(r?.length, 2);
  });

  test('lo que deja de cumplir el filtro DESAPARECE de la vista', () => {
    // El caso real: un vendedor pasa de la sucursal STG a la GTO. Quien esté
    // mirando STG tiene que dejar de verlo sin recargar la página.
    const lista: Fila[] = [{ id: 'a', nombre: 'ANA', sucursalId: 'stg' }];
    const r = aplicarLote<Fila>(
      lista,
      [ev({ id: 'a', datos: { id: 'a', nombre: 'ANA', sucursalId: 'gto' } })],
      { filtrar: (f) => f.sucursalId === 'stg' },
    );

    assert.deepEqual(r, []);
  });

  test('lo que empieza a cumplir el filtro aparece', () => {
    const lista: Fila[] = [];
    const r = aplicarLote<Fila>(
      lista,
      [ev({ id: 'a', datos: { id: 'a', nombre: 'ANA', sucursalId: 'stg' } })],
      { filtrar: (f) => f.sucursalId === 'stg', alPrincipio: true },
    );

    assert.deepEqual(r, [{ id: 'a', nombre: 'ANA', sucursalId: 'stg' }]);
  });

  test('si nada cambia devuelve la MISMA referencia (no re-renderiza)', () => {
    const r = aplicarLote<Fila>(LISTA, [ev({ id: 'zzz', accion: 'delete' })]);

    assert.equal(r, LISTA);
  });

  test('un lote vacío no toca nada', () => {
    assert.equal(aplicarLote<Fila>(LISTA, []), LISTA);
  });

  test('un borrado sin id obliga a recargar en vez de adivinar', () => {
    assert.equal(aplicarLote<Fila>(LISTA, [ev({ id: null, accion: 'delete' })]), null);
  });
});
