/**
 * Qué pasa con los vendedores cuando se borra a su usuario.
 *
 * Equivocarse aquí no da un error: da un vendedor «sin asignar» cuyos pedidos
 * desaparecen de los informes sin que nadie lo note hasta el cierre de mes. Pasó en
 * Holguín el 08/08/2026 y por eso está probado.
 */
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidirBorrado } from '../src/lib/borradoUsuario.ts'

const v = (nombre: string, activo: boolean, pedidos = 0) => ({
  id: nombre, nombre, codigo: null, activo, _count: { pedidos },
})

describe('borrar un usuario', () => {
  test('con un vendedor ACTIVO Y CON PEDIDOS, no se puede', () => {
    // Sin gestor la ingesta le deja la sucursal en nulo, y esos pedidos se esconden.
    const d = decidirBorrado([v('yoan', true, 226)])

    assert.equal(d.permitido, false)
    assert.deepEqual(d.activos.map((x) => x.nombre), ['yoan'])
  })

  test('con uno activo SIN NINGÚN PEDIDO, sí: no hay histórico que esconder', () => {
    // Son los creados a mano por equivocación. Y si vuelven a hacer falta, el CSV los
    // trae otra vez.
    const d = decidirBorrado([v('prueba', true, 0)])

    assert.equal(d.permitido, true)
    assert.deepEqual(d.aLiberar.map((x) => x.nombre), ['prueba'])
  })

  test('con todos DE BAJA, sí: se quedan sin usuario y conservan lo suyo', () => {
    // Su CSV ya no llega, así que nadie les va a tocar la sucursal.
    const d = decidirBorrado([v('yoan', false, 2210), v('luis', false, 634)])

    assert.equal(d.permitido, true)
    assert.deepEqual(d.aLiberar.map((x) => x.nombre), ['yoan', 'luis'])
  })

  test('basta UNO activo con pedidos entre varios inofensivos', () => {
    const d = decidirBorrado([v('ana', false, 71), v('luis', true, 10), v('nuevo', true, 0)])

    assert.equal(d.permitido, false)
    // Y se dice cuál es, no «hay alguno»: sin el nombre hay que ir a buscarlo a mano.
    assert.deepEqual(d.activos.map((x) => x.nombre), ['luis'])
  })

  test('sin vendedores, se borra y no queda nada que liberar', () => {
    const d = decidirBorrado([])

    assert.equal(d.permitido, true)
    assert.deepEqual(d.aLiberar, [])
  })

  test('cuando bloquea, no libera a nadie', () => {
    // Los dos lados tienen que ser coherentes: liberar a medias dejaría a unos sin
    // gestor y a otros con él, con el usuario todavía sin borrar.
    const d = decidirBorrado([v('yoan', true, 5), v('ana', false, 3)])

    assert.deepEqual(d.aLiberar, [])
  })

  test('sin `_count` se trata como cero, no como "quién sabe"', () => {
    // La ruta siempre lo pide, pero si algún día alguien llama sin él, suponer que hay
    // pedidos bloquearía borrados legítimos para siempre y nadie sabría por qué.
    const d = decidirBorrado([{ id: 'x', nombre: 'x', codigo: null, activo: true }])

    assert.equal(d.permitido, true)
  })
})
