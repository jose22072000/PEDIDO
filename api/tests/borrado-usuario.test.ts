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

const v = (nombre: string, activo: boolean) => ({ id: nombre, nombre, codigo: null, activo })

describe('borrar un usuario', () => {
  test('con un vendedor EN ACTIVO, no se puede', () => {
    // Sin gestor, la ingesta le deja la sucursal en nulo y sus pedidos se esconden.
    const d = decidirBorrado([v('yoan', true)])

    assert.equal(d.permitido, false)
    assert.deepEqual(d.activos.map((x) => x.nombre), ['yoan'])
  })

  test('con todos DE BAJA, sí: se quedan sin usuario y conservan lo suyo', () => {
    // Su CSV ya no llega, así que nadie les va a tocar la sucursal.
    const d = decidirBorrado([v('yoan', false), v('luis', false)])

    assert.equal(d.permitido, true)
    assert.deepEqual(d.aLiberar.map((x) => x.nombre), ['yoan', 'luis'])
  })

  test('basta UNO activo entre varios de baja para bloquear', () => {
    const d = decidirBorrado([v('yoan', false), v('luis', true), v('ana', false)])

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
    // Los dos lados del objeto tienen que ser coherentes: liberar a medias dejaría a
    // unos sin gestor y a otros con él, con el usuario todavía sin borrar.
    const d = decidirBorrado([v('yoan', true), v('ana', false)])

    assert.deepEqual(d.aLiberar, [])
  })
})
