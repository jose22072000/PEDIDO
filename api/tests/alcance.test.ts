import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

import {
  alcanceDeLectura,
  alcanceDeEscritura,
  sucursalParaCrear,
} from '../src/lib/sucursalContext.ts';

/**
 * La prueba que faltaba.
 *
 * El 07/08/2026 seis personas veían todos los pedidos y no podían completar
 * ninguno, porque listar y completar usaban reglas de alcance distintas. Nada lo
 * detectaba: cada ruta estaba "bien" por separado.
 *
 * Esto comprueba la relación entre las dos, que es donde estaba el fallo.
 */

const SECRETO = process.env.JWT_SECRET || 'fallback-secret-key';

function peticion(token: Record<string, unknown>, cabeceraSucursal?: string): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${jwt.sign(token, SECRETO)}`,
  };

  if (cabeceraSucursal) headers['x-sucursal-id'] = cabeceraSucursal;

  return { headers, query: {}, body: {}, params: {} } as unknown as Request;
}

const CASOS = [
  {
    nombre: 'Super Admin sin sucursal enfocada',
    req: () => peticion({ userId: 'a', username: 'admin', role: 'Super Admin', sucursalId: null }),
  },
  {
    nombre: 'Super Admin enfocado en una sucursal',
    req: () =>
      peticion({ userId: 'a', username: 'admin', role: 'Super Admin', sucursalId: null }, 'CAM'),
  },
  {
    nombre: 'Administrador de su sucursal',
    req: () => peticion({ userId: 'b', username: 'ana', role: 'Administrador', sucursalId: 'HOL' }),
  },
  {
    nombre: 'Operador de su sucursal',
    req: () => peticion({ userId: 'c', username: 'dai', role: 'Operador', sucursalId: 'CAM' }),
  },
  {
    nombre: 'Gestor de su sucursal',
    req: () => peticion({ userId: 'd', username: 'ges', role: 'Gestor', sucursalId: 'TUN' }),
  },
  {
    nombre: 'usuario sin sucursal y sin ser global',
    req: () => peticion({ userId: 'e', username: 'huerfano', role: 'Operador', sucursalId: null }),
  },
];

describe('leer y escribir alcanzan LO MISMO', () => {
  for (const caso of CASOS) {
    test(caso.nombre, () => {
      const leer = alcanceDeLectura(caso.req());
      const escribir = alcanceDeEscritura(caso.req());

      // Si esto falla, hay pedidos que se ven y no se pueden tocar (o al revés,
      // que es peor: tocar lo que no se debería ver).
      assert.deepEqual(escribir.where, leer.where, 'el filtro tiene que ser el mismo');
      assert.equal(escribir.error, leer.error, 'el error tiene que ser el mismo');
      assert.equal(escribir.sucursalId, leer.sucursalId);
    });
  }
});

describe('a qué llega cada uno', () => {
  test('EL FALLO: el Super Admin sin sucursal llega a TODO, también para escribir', () => {
    const a = alcanceDeEscritura(CASOS[0].req());

    assert.deepEqual(a.where, {}, 'sin filtro = todas las sucursales');
    assert.equal(a.error, undefined, 'no puede dar error: es lo que rompio completar');
    assert.equal(a.isGlobalAdmin, true);
  });

  test('el Super Admin enfocado queda limitado a esa sucursal', () => {
    assert.deepEqual(alcanceDeLectura(CASOS[1].req()).where, { sucursalId: 'CAM' });
  });

  test('un usuario normal queda en la SUYA', () => {
    assert.deepEqual(alcanceDeLectura(CASOS[2].req()).where, { sucursalId: 'HOL' });
    assert.deepEqual(alcanceDeLectura(CASOS[3].req()).where, { sucursalId: 'CAM' });
  });

  test('un usuario normal NO puede pedir otra sucursal por la cabecera', () => {
    const a = alcanceDeLectura(
      peticion({ userId: 'c', username: 'dai', role: 'Operador', sucursalId: 'CAM' }, 'HOL'),
    );

    assert.ok(a.error, 'tiene que rechazarse, no colarse');
  });

  test('sin sucursal y sin ser global NO cae en "todas"', () => {
    const a = alcanceDeLectura(CASOS[5].req());

    // Lo peligroso seria que un `where` vacio se leyera como "todas".
    assert.ok(a.error, 'tiene que dar error');
    assert.equal(a.sucursalId, null);
  });
});

describe('crear necesita UNA sucursal', () => {
  test('el Super Admin sin enfocar recibe una instruccion, no un error seco', () => {
    const { sucursalId, error } = sucursalParaCrear(CASOS[0].req());

    assert.equal(sucursalId, undefined);
    assert.match(String(error), /selector/i, 'el mensaje tiene que decir QUE hacer');
  });

  test('el Super Admin enfocado sí puede crear', () => {
    assert.equal(sucursalParaCrear(CASOS[1].req()).sucursalId, 'CAM');
  });

  test('un usuario normal crea en la suya', () => {
    assert.equal(sucursalParaCrear(CASOS[3].req()).sucursalId, 'CAM');
  });

  test('sin sucursal se le dice que pida que se la asignen', () => {
    assert.match(String(sucursalParaCrear(CASOS[5].req()).error), /asigne/i);
  });
});
