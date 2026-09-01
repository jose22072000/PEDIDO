/**
 * Lo que pesa una factura.
 *
 * De aquí sale el precio del domicilio cuando el cliente cambia el pedido, así que lo que
 * más importa no es que el número salga bien: es que NO salga cuando falta un peso. Un
 * total calculado con la mitad de los kilos es creíble, entra sin protestar y pisa el
 * precio que había, que sí estaba bien.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pesar } from '../src/lib/pesarFactura.ts'

const CATALOGO = [
  { sku: 'C-1500', nombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', pesoKg: 9.5, categoria: 'BEBIDAS' },
  { sku: 'M-350', nombre: 'MALTA PARRANDA 350 ML', pesoKg: 4.2, categoria: 'BEBIDAS' },
  { sku: 'S-000', nombre: 'ENTREGA A DOMICILIO', pesoKg: null, categoria: 'SERV' },
  { sku: 'T-001', nombre: 'TELEVISOR 43 PULGADAS', pesoKg: null, categoria: 'ELECTRO' },
]

test('se pesa por el código de Ventra, que es el sku del catálogo', () => {
  const kg = pesar(
    [
      { producto: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', codigo: 'C-1500', cantidad: 10 },
      { producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 5 },
    ],
    CATALOGO,
  )

  assert.equal(kg, 9.5 * 10 + 4.2 * 5)
})

test('sin código se cae al nombre EXACTO, y a nada más', () => {
  assert.equal(pesar([{ producto: 'MALTA PARRANDA 350 ML', codigo: null, cantidad: 2 }], CATALOGO), 8.4)
  // Un nombre parecido no cuenta: aquí una coincidencia de más cambia lo que se cobra.
  assert.equal(pesar([{ producto: 'MALTA PARRANDA 350', codigo: null, cantidad: 2 }], CATALOGO), null)
})

test('el cobro del reparto no pesa ni estorba', () => {
  /**
   * Era el fallo que se comía la función entera: la línea de «ENTREGA A DOMICILIO» no
   * tiene peso, así que contaba como línea sin pesar y descartaba la recotización. O sea
   * que justo las facturas CON domicilio eran las que no se podían recotizar.
   */
  const kg = pesar(
    [
      { producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 10 },
      { producto: 'ENTREGA A DOMICILIO', codigo: 'S-000', cantidad: 1 },
    ],
    CATALOGO,
  )

  assert.equal(kg, 42)
})

test('una mercancía sin peso descarta el total entero', () => {
  // Ir corto también es cobrar mal, y de menos no se nota nunca.
  assert.equal(
    pesar(
      [
        { producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 10 },
        { producto: 'TELEVISOR 43 PULGADAS', codigo: 'T-001', cantidad: 1 },
      ],
      CATALOGO,
    ),
    null,
  )
})

test('una factura de puro servicio no pesa: no es que pese cero', () => {
  assert.equal(pesar([{ producto: 'ENTREGA A DOMICILIO', codigo: 'S-000', cantidad: 1 }], CATALOGO), null)
  assert.equal(pesar([], CATALOGO), null)
})
