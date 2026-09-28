/**
 * Un peso de CERO no es un peso: es un dato que falta disfrazado de número.
 *
 * Ventra manda `0` en los diez productos MÁS PESADOS del catálogo —el congelador, el
 * exhibidor de 13 pies, el kit de batería e inversor, el panel solar y cinco cajas de
 * ron—: 100 filas de 1.300, medidas el 28/09/2026.
 *
 * Pasarlo tal cual es peor que no tener el dato. Un nulo se lee «no se sabe» y quien arma
 * la carga lo marca; un cero SE SUMA, y un camión con un congelador y dos paneles solares
 * sale pesando cero kilos sin que falle nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { indexarCatalogo } from '../src/lib/cruceProducto';

const sinVinculos = new Map<string, string>();

test('un peso de cero entra como «no se sabe», no como cero', () => {
  const cat = indexarCatalogo(
    [{ nombre: 'CONGELADOR HORIZONTAL MILEXUS 4.2 PIES', precio: 900, pesoKg: 0, stock: 3 }],
    sinVinculos,
  );

  // Nulo, no cero: quien lo reciba tiene que poder distinguir «no se sabe» de «no pesa».
  assert.equal(cat.buscar('CONGELADOR HORIZONTAL MILEXUS 4.2 PIES')?.pesoKg, null);
});

test('un peso de verdad se respeta, por pequeño que sea', () => {
  const cat = indexarCatalogo(
    [{ nombre: 'SOBRE DE SAL 5 G', precio: 1, pesoKg: 0.005, stock: 10 }],
    sinVinculos,
  );

  assert.equal(cat.buscar('SOBRE DE SAL 5 G')?.pesoKg, 0.005);
});

test('y con el producto duplicado, manda la fila que SÍ trae el peso', () => {
  // Ventra duplica productos con dos códigos, y a veces uno trae cero y el otro el peso
  // bueno. Antes el cero llegaba primero y ganaba, porque `0 ?? x` es 0.
  const cat = indexarCatalogo(
    [
      { nombre: 'RON SANTIAGO EXTRA ANEJO 11 ANOS CAJA 6U', precio: 60, pesoKg: 0, stock: 0 },
      { nombre: 'RON SANTIAGO EXTRA ANEJO 11 ANOS CAJA 6U', precio: null, pesoKg: 8.4, stock: 12 },
    ],
    sinVinculos,
  );
  const r = cat.buscar('RON SANTIAGO EXTRA ANEJO 11 ANOS CAJA 6U');

  assert.equal(r?.pesoKg, 8.4);
  // Y sin perder el precio, que venía en la otra fila.
  assert.equal(r?.precio, 60);
});
