import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

import {
  resolveSucursalId,
  resolveSucursalScope,
  getRequesterContext,
} from '../src/lib/sucursalContext.ts';

/**
 * Estas pruebas existen por un fallo REAL de producción: el Super Admin entraba a
 * Vendedores y veía CERO filas, sin ningún error. El desplegable manda '__todas__'
 * como valor de "todas las sucursales" y el backend lo estaba buscando como si
 * fuera el id de una sucursal: no encontraba ninguna y devolvía la lista vacía.
 *
 * Se tardó un buen rato en encontrarlo porque no fallaba nada: simplemente no
 * había datos. Esto lo habría cazado en un segundo.
 */

const SECRETO = process.env.JWT_SECRET || 'fallback-secret-key';

function peticion(opts: {
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  token?: Record<string, unknown>;
} = {}): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  if (opts.token) headers.authorization = `Bearer ${jwt.sign(opts.token, SECRETO)}`;

  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    headers,
    cookies: {},
  } as unknown as Request;
}

const SUPER_ADMIN = { userId: 'u1', username: 'admin', role: 'Super Admin', sucursalId: null };
const ADMIN_STG = { userId: 'u2', username: 'ana', role: 'Administrador', sucursalId: 'suc-stg' };

describe('centinelas de "todas las sucursales"', () => {
  // El navegador que ya tenía '__todas__' guardado lo sigue mandando en la
  // cabecera aunque el front de hoy la borre: el backend TIENE que aguantarlo.
  for (const centinela of ['__todas__', 'all', 'todas', '*', 'null', 'undefined', 'ALL', '  all  ']) {
    test(`'${centinela}' no se toma por un id de sucursal`, () => {
      assert.equal(
        resolveSucursalId(peticion({ headers: { 'x-sucursal-id': centinela } })),
        null,
      );
    });
  }

  test('un id de verdad sí pasa', () => {
    assert.equal(
      resolveSucursalId(peticion({ headers: { 'x-sucursal-id': 'suc-stg' } })),
      'suc-stg',
    );
  });

  test('la cadena vacía tampoco es un id', () => {
    assert.equal(resolveSucursalId(peticion({ headers: { 'x-sucursal-id': '   ' } })), null);
  });

  test('vale igual por body y por query, no solo por cabecera', () => {
    assert.equal(resolveSucursalId(peticion({ body: { sucursalId: '__todas__' } })), null);
    assert.equal(resolveSucursalId(peticion({ query: { sucursalId: '__todas__' } })), null);
    assert.equal(resolveSucursalId(peticion({ body: { sucursalId: 'suc-gto' } })), 'suc-gto');
  });
});

describe('alcance del Super Admin', () => {
  test('con el centinela ve TODAS (null), que es lo que fallaba', () => {
    const r = resolveSucursalScope(
      peticion({ token: SUPER_ADMIN, headers: { 'x-sucursal-id': '__todas__' } }),
      { allowAllForAdmin: true, defaultAllForAdmin: true },
    );

    assert.equal(r.error, undefined);
    assert.equal(r.sucursalId, null); // null = sin filtro = todas
    assert.equal(r.isGlobalAdmin, true);
  });

  test('si elige una sucursal concreta, se enfoca en esa', () => {
    const r = resolveSucursalScope(
      peticion({ token: SUPER_ADMIN, headers: { 'x-sucursal-id': 'suc-stg' } }),
      { allowAllForAdmin: true, defaultAllForAdmin: true },
    );

    assert.equal(r.sucursalId, 'suc-stg');
  });

  test('sin elegir nada, también ve todas', () => {
    const r = resolveSucursalScope(peticion({ token: SUPER_ADMIN }), {
      allowAllForAdmin: true,
      defaultAllForAdmin: true,
    });

    assert.equal(r.sucursalId, null);
  });
});

describe('aislamiento entre sucursales', () => {
  test('un Administrador NO puede operar otra sucursal aunque mande la cabecera', () => {
    const r = resolveSucursalScope(
      peticion({ token: ADMIN_STG, headers: { 'x-sucursal-id': 'suc-gto' } }),
      { allowAllForAdmin: true },
    );

    assert.ok(r.error, 'debería rechazarse');
    assert.equal(r.isGlobalAdmin, false);
  });

  test('un Administrador que pide "todas" cae en la SUYA, nunca en todas', () => {
    const r = resolveSucursalScope(
      peticion({ token: ADMIN_STG, headers: { 'x-sucursal-id': 'all' } }),
      { allowAllForAdmin: true },
    );

    // No da error: el centinela se anula y se cae en la sucursal propia. Lo que
    // importa es que NO acabe en null, que significaría "todas las sucursales".
    assert.equal(r.sucursalId, 'suc-stg');
    assert.notEqual(r.sucursalId, null);
    assert.equal(r.isGlobalAdmin, false);
  });

  test('sin cabecera, un Administrador cae en la SUYA', () => {
    const r = resolveSucursalScope(peticion({ token: ADMIN_STG }), { allowAllForAdmin: true });

    assert.equal(r.sucursalId, 'suc-stg');
  });

  test('un token inválido no da privilegios', () => {
    const req = peticion({ headers: { authorization: 'Bearer basura' } });

    assert.equal(getRequesterContext(req).isGlobalAdmin, false);
    assert.equal(getRequesterContext(req).canManageUsers, false);
  });
});

describe('roles', () => {
  test('Administrador gestiona usuarios pero NO es global', () => {
    const c = getRequesterContext(peticion({ token: ADMIN_STG }));

    assert.equal(c.canManageUsers, true);
    assert.equal(c.isGlobalAdmin, false);
  });

  test('Gestor no gestiona usuarios y se le marca como gestor', () => {
    const c = getRequesterContext(
      peticion({ token: { userId: 'u3', username: 'pedro', role: 'Gestor', sucursalId: 'suc-stg' } }),
    );

    assert.equal(c.isGestor, true);
    assert.equal(c.canManageUsers, false);
    assert.equal(c.isGlobalAdmin, false);
  });
});
