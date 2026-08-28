/**
 * El cruce Parranda -> Ventra: lo que hace que un pedido tenga precio y peso.
 *
 * Los tres fallos que ya costaron caros están aquí como pruebas:
 *   - el producto duplicado, con el precio en una fila y el peso en otra;
 *   - el vínculo que ató una persona, que la integración no miraba;
 *   - el nombre que sólo cruza estando contenido en el de Ventra.
 *
 * Ninguno de los tres falla cuando se rompe: sale un número, cuadra, y se descubre
 * comparando dos informes meses después.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { indexarCatalogo, unidadesDeVenta, type FilaCatalogo } from '../src/lib/cruceProducto.ts';
import { normalizarProducto } from '../src/lib/nombreProducto.ts';

const sinVinculos = new Map<string, string>();

const fila = (nombre: string, precio: number | null, pesoKg: number | null): FilaCatalogo =>
  ({ nombre, precio, pesoKg, stock: null });

test('cruza aunque Parranda anteponga la categoría y pegue las unidades', () => {
  const cat = indexarCatalogo([fila('ARROZ BLANCO 25 KG SACO', 25.5, 25)], sinVinculos);
  const c = cat.buscar('ALIMENTOS ARROZ BLANCO 25KG SACO');

  assert.equal(c?.precio, 25.5);
  assert.equal(c?.pesoKg, 25);
});

test('el producto duplicado no pierde ni el precio ni el peso', () => {
  // Ventra manda la misma fila dos veces: una con precio y otra con peso. Quedarse con
  // cualquiera de las dos perdía el dato de la otra, y ése era el fallo original.
  const cat = indexarCatalogo(
    [fila('MALTA GUAJIRA 330 ML', 12.4, null), fila('MALTA GUAJIRA 330 ML', null, 8.1)],
    sinVinculos,
  );
  const c = cat.buscar('BEBIDAS MALTA GUAJIRA 0.33L');

  assert.equal(c?.precio, 12.4);
  assert.equal(c?.pesoKg, 8.1);
});

test('da igual en qué orden lleguen las filas duplicadas', () => {
  const alReves = indexarCatalogo(
    [fila('MALTA GUAJIRA 330 ML', null, 8.1), fila('MALTA GUAJIRA 330 ML', 12.4, null)],
    sinVinculos,
  );
  const c = alReves.buscar('MALTA GUAJIRA 330 ML');

  assert.equal(c?.precio, 12.4);
  assert.equal(c?.pesoKg, 8.1);
});

test('el vínculo a mano manda sobre el cruce automático', () => {
  const vinculos = new Map([
    [normalizarProducto('ALIMENTOS ACEITE 1L'), normalizarProducto('ACEITE GIRASOL 1 LT BOTELLA')],
  ]);
  const cat = indexarCatalogo(
    [fila('ACEITE GIRASOL 1 LT BOTELLA', 3.1, 0.95), fila('ACEITE 1000 ML', 9.9, 99)],
    vinculos,
  );
  const c = cat.buscar('ALIMENTOS ACEITE 1L');

  assert.equal(c?.precio, 3.1, 'debe ganar el que ató la persona, no el que cruza solo');
  assert.equal(c?.pesoKg, 0.95);
});

test('el peso sale de la MISMA fila que el precio', () => {
  // Es el fallo que había: el panel se quedaba con la fila con precio y la integración
  // con la del peso, así que se cobraba el domicilio de un producto y el importe de otro.
  const vinculos = new Map([
    [normalizarProducto('RON AÑEJO 7'), normalizarProducto('RON SANTIAGO 7 ANOS 700 ML')],
  ]);
  const cat = indexarCatalogo(
    [fila('RON SANTIAGO 7 ANOS 700 ML', 14, 1.2), fila('RON SANTIAGO 12 ANOS 700 ML', 30, 1.2)],
    vinculos,
  );
  const c = cat.buscar('RON AÑEJO 7');

  assert.equal(c?.nombre, 'RON SANTIAGO 7 ANOS 700 ML');
  assert.equal(c?.precio, 14);
});

test('cruza por contenido cuando Ventra añade el tipo delante y el formato detrás', () => {
  const cat = indexarCatalogo([fila('CERVEZA PARRANDA 330 ML BLISTER 6U', 6.5, 4.2)], sinVinculos);
  const c = cat.buscar('PARRANDA 0.33L');

  assert.equal(c?.precio, 6.5);
});

test('con DOS candidatos por contenido no se elige ninguno', () => {
  // Acertar a medias es peor que no acertar: un precio equivocado no falla, sale mal y
  // cuadra. "PARRANDA 330 ML" podría ser el blíster de 6 o la caja de 24.
  const cat = indexarCatalogo(
    [
      fila('CERVEZA PARRANDA 330 ML BLISTER 6U', 6.5, 4.2),
      fila('CERVEZA PARRANDA 330 ML CAJA 24U', 24, 16.8),
    ],
    sinVinculos,
  );

  assert.equal(cat.buscar('PARRANDA 0.33L'), undefined);
});

test('un producto que no está devuelve undefined, no una fila cualquiera', () => {
  const cat = indexarCatalogo([fila('ARROZ BLANCO 25 KG SACO', 25.5, 25)], sinVinculos);

  assert.equal(cat.buscar('TELEVISOR 43 PULGADAS'), undefined);
  assert.equal(cat.buscar(''), undefined);
  assert.equal(cat.buscar(null), undefined);
});

test('las unidades de venta son los packs, y las sueltas sólo si no hay packs', () => {
  assert.equal(unidadesDeVenta(4, 24), 4);
  assert.equal(unidadesDeVenta(null, 24), 24);
  assert.equal(unidadesDeVenta(0, 24), 24, 'cero packs no es "cero cajas": es que no vino el dato');
});
