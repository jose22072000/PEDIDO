/**
 * Lo que no es mercancía.
 *
 * «ENTREGA A DOMICILIO» es el cobro del reparto facturado como una línea más. Tratarla
 * como un producto hace tres estropicios: sale en el buscador al meter un pedido a mano,
 * cuenta como línea sin peso y bloquea la recotización del domicilio, y se copia al
 * pedido como si hubiera que subirla al camión.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { esServicio, esEntregaADomicilio } from '../src/lib/servicios.ts'

test('la categoría SERV de Ventra es servicio', () => {
  assert.ok(esServicio({ nombre: 'ENTREGA A DOMICILIO', categoria: 'SERV' }))
  assert.ok(esServicio({ nombre: 'LO QUE SEA', categoria: 'Servicios' }))
})

test('y por el nombre, para cuando falte la categoría', () => {
  assert.ok(esServicio({ nombre: 'Entrega a domicilio', categoria: null }))
  assert.ok(esEntregaADomicilio({ nombre: 'ENTREGA A DOMICILIO' }))
})

test('una cerveza no es un servicio por llevar una palabra suelta', () => {
  // Se pide la frase entera a propósito: con «entrega» a secas, cualquier producto que la
  // mencionara desaparecería del catálogo y nadie sabría por qué.
  assert.equal(esServicio({ nombre: 'CERVEZA PARRANDA 1500 ML', categoria: 'BEBIDAS' }), false)
  assert.equal(esServicio({ nombre: 'CAJA DE ENTREGA RAPIDA', categoria: 'ENVASES' }), false)
})
