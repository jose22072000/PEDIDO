import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

import { getRequesterContext } from '../src/lib/sucursalContext.ts';

/**
 * Quien puede CERRAR y quien puede BORRAR un pedido.
 *
 * El Gestor sube los pedidos de sus vendedores y los ve, pero no los cierra:
 * completar es decir "esto ya se facturo", y eso lo dice quien factura (el
 * Operador) o quien lleva la sucursal.
 *
 * Se prueba aqui y no en la pantalla porque la pantalla solo esconde botones.
 * Lo que de verdad impide la accion es esta funcion, y un rol escrito de otra
 * forma —"Gestor" en el token, 'GESTOR' en la comparacion— la dejaria pasar sin
 * que nadie se enterara.
 */

const SECRETO = process.env.JWT_SECRET || 'fallback-secret-key';

function peticion(rol: string, sucursalId: string | null = 'CAM'): Request {
  const token = jwt.sign({ userId: 'u', username: 'quien', role: rol, sucursalId }, SECRETO);

  return {
    headers: { authorization: `Bearer ${token}` },
    query: {},
    body: {},
    params: {},
  } as unknown as Request;
}

describe('completar un pedido', () => {
  test('el GESTOR no puede', () => {
    assert.equal(getRequesterContext(peticion('Gestor')).puedeCompletarPedidos, false);
  });

  for (const rol of ['Operador', 'Supervisor', 'Administrador']) {
    test(`el ${rol} si puede`, () => {
      assert.equal(getRequesterContext(peticion(rol)).puedeCompletarPedidos, true);
    });
  }

  test('el Super Admin si puede, aunque no tenga sucursal', () => {
    assert.equal(getRequesterContext(peticion('Super Admin', null)).puedeCompletarPedidos, true);
  });

  test('sin token no puede nadie', () => {
    const anonimo = { headers: {}, query: {}, body: {}, params: {} } as unknown as Request;

    assert.equal(getRequesterContext(anonimo).puedeCompletarPedidos, false);
  });
});

describe('borrar un pedido', () => {
  test('el GESTOR no puede', () => {
    assert.equal(getRequesterContext(peticion('Gestor')).puedeBorrarPedidos, false);
  });

  test('el OPERADOR tampoco: factura, y lo borrado no vuelve', () => {
    assert.equal(getRequesterContext(peticion('Operador')).puedeBorrarPedidos, false);
  });

  for (const rol of ['Supervisor', 'Administrador']) {
    test(`el ${rol} si puede`, () => {
      assert.equal(getRequesterContext(peticion(rol)).puedeBorrarPedidos, true);
    });
  }

  test('el Super Admin si puede', () => {
    assert.equal(getRequesterContext(peticion('Super Admin', null)).puedeBorrarPedidos, true);
  });
});
