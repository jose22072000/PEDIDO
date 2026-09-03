/**
 * Los folios hermanos: un vendedor mete a todos sus clientes de la jornada bajo un folio.
 *
 * Lo que estas pruebas defienden es UNA cosa: **a un cliente que ya tiene folio no se le
 * mueve nunca**. El folio viaja a la nota de la factura de Ventra —el operador lo copia de
 * la pantalla— y es lo único que ata una factura a un pedido. Si un reimporte le cambia el
 * sufijo a un cliente, ese pedido se queda con la factura de otro, y un pedido con la
 * factura de otro parece correcto: nadie lo mira.
 *
 * En producción hay 1.677 familias así, y en Santiago son 1.038 de 3.008 pedidos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { asignarSufijos, claveDeCliente, type FoliosYaAsignados } from '../src/dto/orderRecord.dto.ts';

/** Un registro con lo mínimo que mira `asignarSufijos`. */
const registro = (vendedor: string, folio: string, cliente: string): any => ({
  seller: { name: vendedor, code: vendedor },
  client: { nombre: cliente },
  order: { folio },
  item: {},
});

const foliosDe = (rs: any[]) =>
  Object.fromEntries(rs.map((r) => [r.client.nombre, r.order.folio]));

test('un folio de un solo cliente se queda como vino', () => {
  const r = asignarSufijos([registro('RAYDEL', 'PRM25-260901-1806', 'CAFETERIA 560')]);

  assert.equal(r[0].order.folio, 'PRM25-260901-1806');
});

test('varios clientes en el mismo folio se separan', () => {
  const r = asignarSufijos([
    registro('RAYDEL', 'PRM25-260901-1808', 'CAFETERIA 560'),
    registro('RAYDEL', 'PRM25-260901-1808', 'TCP YADIRIS'),
    registro('RAYDEL', 'PRM25-260901-1808', 'TCP MATILDE'),
  ]);
  const folios = Object.values(foliosDe(r));

  // Tres pedidos distintos, tres folios distintos, todos de la misma familia.
  assert.equal(new Set(folios).size, 3);
  for (const f of folios) assert.match(f, /^PRM25-260901-1808(-\d+)?$/);
});

test('el orden de las filas NO cambia el resultado', () => {
  const clientes = ['TCP MATILDE', 'CAFETERIA 560', 'TCP ANA'];
  const uno = foliosDe(asignarSufijos(clientes.map((c) => registro('RAYDEL', 'F-1', c))));
  const otro = foliosDe(asignarSufijos([...clientes].reverse().map((c) => registro('RAYDEL', 'F-1', c))));

  assert.deepEqual(uno, otro);
});

test('AL CLIENTE QUE YA TIENE FOLIO NO SE LE TOCA', () => {
  // Lo que hay en la base: cinco clientes ya repartidos.
  const yaAsignados: FoliosYaAsignados = new Map([
    ['RAYDEL|PRM25-260901-1808', new Map([
      [claveDeCliente('CAFETERIA 560'), 'PRM25-260901-1808'],
      [claveDeCliente('TCP YADIRIS'), 'PRM25-260901-1808-1'],
      [claveDeCliente('TCP MATILDE'), 'PRM25-260901-1808-2'],
      [claveDeCliente('TCP ANA'), 'PRM25-260901-1808-3'],
      [claveDeCliente('EL FOCO'), 'PRM25-260901-1808-4'],
    ])],
  ]);

  // Y el archivo llega con los mismos clientes EN OTRO ORDEN, más uno nuevo.
  const r = asignarSufijos([
    registro('RAYDEL', 'PRM25-260901-1808', 'EL FOCO'),
    registro('RAYDEL', 'PRM25-260901-1808', 'TCP ANA'),
    registro('RAYDEL', 'PRM25-260901-1808', 'BAZAR TUCHY TUCHI'),
    registro('RAYDEL', 'PRM25-260901-1808', 'CAFETERIA 560'),
  ], yaAsignados);
  const folios = foliosDe(r);

  assert.equal(folios['CAFETERIA 560'], 'PRM25-260901-1808');
  assert.equal(folios['TCP ANA'], 'PRM25-260901-1808-3');
  assert.equal(folios['EL FOCO'], 'PRM25-260901-1808-4');
  // El nuevo toma el primer número libre, sin pisar a nadie.
  assert.equal(folios['BAZAR TUCHY TUCHI'], 'PRM25-260901-1808-5');
});

test('un cliente solo, pero que ya tenía folio, conserva el suyo', () => {
  const yaAsignados: FoliosYaAsignados = new Map([
    ['RAYDEL|F-9', new Map([[claveDeCliente('TCP ANA'), 'F-9-2']])],
  ]);
  const r = asignarSufijos([registro('RAYDEL', 'F-9', 'TCP ANA')], yaAsignados);

  // Sin mirar la base, éste se habría quedado con `F-9` a secas y habría perdido su
  // factura: es exactamente el caso que rompía.
  assert.equal(r[0].order.folio, 'F-9-2');
});

test('el mismo folio de DOS vendedores son dos familias, no una', () => {
  const r = asignarSufijos([
    registro('RAYDEL', 'F-7', 'CAFETERIA 560'),
    registro('RIGOBERTO', 'F-7', 'MI TERRAZA'),
  ]);

  // El folio no es único entre vendedores: la clave real es sucursal + folio + vendedor.
  // Cada uno se queda con el suyo, sin sufijo, porque en su familia está solo.
  assert.equal(r[0].order.folio, 'F-7');
  assert.equal(r[1].order.folio, 'F-7');
});

test('el mismo cliente escrito distinto es el mismo cliente', () => {
  const r = asignarSufijos([
    registro('RAYDEL', 'F-3', 'Cafetería  560'),
    registro('RAYDEL', 'F-3', 'CAFETERIA 560'),
  ]);

  // Dos filas del mismo cliente, un solo pedido: si se contaran como dos, el cliente
  // acabaría partido en dos pedidos con la mitad de la mercancía cada uno.
  assert.equal(r[0].order.folio, 'F-3');
  assert.equal(r[1].order.folio, 'F-3');
});
