/**
 * Qué cliente es un «consumo propio» y cuál no.
 *
 * Los nombres de aquí abajo están copiados de producción tal cual (25/09/2026): son los
 * de verdad, con sus faltas y sus ocho maneras de escribir lo mismo. La prueba que más
 * importa es la última tanda: en Holguín hay ochenta clientes llamados «PUNTO DE VENTA
 * FULANITO» que son kioscos con su dueño, y meterlos en el cajón del consumo propio
 * sería enseñarle a la operadora el pedido de otro para que lo copie en una factura.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { esConsumoPropio } from '../src/lib/consumoPropio';

test('los que lo dicen con todas las letras', () => {
  for (const nombre of [
    'CONSUMO PROPIO',
    'CONSUMO PROPIO (ALEXANDER)',
    'CONSUMO PROPIO(MAYLEN)',
    'CONSUMO PROPIO( ALFREDO)',
    'CLIENTE CONSUMO MARIACNELIS',
    'CLIENTE DE CONSUMO YANIOR',
    'CLIENTES DE CONSUMO HUMBERTO',
    'Gregorio Alvarez Ponce CONSUMO PROPIO',
  ]) {
    assert.equal(esConsumoPropio(nombre), true, nombre);
  }
});

test('y los que lo escriben deprisa', () => {
  // Estas tres están en producción. Un `includes("CONSUMO")` las deja fuera a todas.
  for (const nombre of [
    'PDV CLIENTE COMSUMO LAS TUNAS',
    'AIDEE REMON PDV LAS TUNAS (CLIENTE DE COSUMO)',
    'PDV_LASTUNAS(CLIENTECONSUMO)',
    'PDV_LAS TUNAS(LIENTE DE CONSUMO)',
  ]) {
    assert.equal(esConsumoPropio(nombre), true, nombre);
  }
});

test('PDV es el nombre que le dan en Las Tunas, y va aunque no diga consumo', () => {
  // 660 pedidos tiene este, el que más de todos.
  assert.equal(esConsumoPropio('PDV_ LAS TUNAS'), true);
  assert.equal(esConsumoPropio('PDV(CLIENTE DE CONSUMO)'), true);
  assert.equal(esConsumoPropio('PDV- CLIENTES DE CONSUMO RSP'), true);
  assert.equal(esConsumoPropio('RAUL SALGADO PENA (PDV CLIENTE DE CONSUMO)'), true);
});

test('UN PUNTO DE VENTA ES UN CLIENTE DE VERDAD', () => {
  // Ochenta en Holguín, y tres en Santiago. Son kioscos con dueño, no el cajón de nadie.
  for (const nombre of [
    'PUNTO DE VENTA YAMILA BLANCO',
    'PUNTO DE VENTA YASNIEL CABRERA',
    'RPY PUNTO DE VENTA ARAIDA',
    'PUNTO DE VENTA LA MALTERA ISRAEL AGUERO',
    'YOLIMIR PUNTO DE VENTA DULCERIA',
  ]) {
    assert.equal(esConsumoPropio(nombre), false, nombre);
  }
});

test('ni un cliente normal se cuela', () => {
  for (const nombre of [
    'KIOSCO JOSE ARMANDO',
    'MIROSLAVA CONSTANTIN LOPEZ',
    'CAFETERIA EL OASIS AYLIN RODRIGUEZ',
    'JOSE RAMON VALERO NUEZ',
    'PDVSA MARTINEZ',            // empieza por PDV pero es otra palabra
    '',
  ]) {
    assert.equal(esConsumoPropio(nombre), false, nombre);
  }
  assert.equal(esConsumoPropio(null), false);
  assert.equal(esConsumoPropio(undefined), false);
});

test('las tildes y las mayúsculas dan igual', () => {
  assert.equal(esConsumoPropio('cliente de consúmo'), true);
  assert.equal(esConsumoPropio('Consumo Propio'), true);
});
