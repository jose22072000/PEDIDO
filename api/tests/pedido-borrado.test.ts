/**
 * Un pedido BORRADO a mano no vuelve a entrar con el archivo.
 *
 * El archivo del vendedor se relee cada pocos minutos y él lo resube cuando no ve pasar
 * nada, así que hasta ahora borrar un pedido duraba hasta la siguiente pasada: volvía
 * entero, con su cliente y sus líneas. Desde fuera parece que el botón no hace nada.
 *
 * Lo que defienden estas pruebas son las dos mitades del problema:
 *
 *   1. **Por dónde se reconoce**: folio SIN nuestro sufijo + cliente (y vendedor y
 *      sucursal). Un folio lo comparten varios clientes de la jornada, así que borrar el
 *      de uno no puede llevarse a los demás.
 *   2. **El sufijo sigue siendo suyo**: el número que tenía el borrado queda reservado.
 *      Si otro cliente se lo quedara, levantar el borrado devolvería ese pedido con un
 *      folio distinto del que se copió a la nota de la factura de Ventra — que es el
 *      error caro que `asignarSufijos` existe para no repetir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  claveDePedido,
  clavesDeBorrados,
  folioBaseDe,
  reservarFoliosBorrados,
  type NotaDeBorrado,
} from '../src/lib/pedidoBorrado.ts';
import { asignarSufijos, claveDeCliente, type FoliosYaAsignados } from '../src/dto/orderRecord.dto.ts';

const registro = (vendedor: string, folio: string, cliente: string): any => ({
  seller: { name: vendedor, code: vendedor },
  client: { nombre: cliente },
  order: { folio },
  item: {},
});

const foliosDe = (rs: any[]) => Object.fromEntries(rs.map((r) => [r.client.nombre, r.order.folio]));

const nota = (folio: string, cliente: string, vendedor = 'RAYDEL'): NotaDeBorrado => ({
  folio,
  folioBase: folioBaseDe(folio),
  clienteNombre: cliente,
  vendedorCodigo: vendedor,
  vendedorNombre: vendedor,
});

// ---------------------------------------------------------------- el folio base

test('el sufijo NUESTRO se quita; el número del folio NO', () => {
  // `-1` y `-2` los ponemos nosotros para separar clientes.
  assert.equal(folioBaseDe('PRM25-260901-1808-1'), 'PRM25-260901-1808');
  assert.equal(folioBaseDe('PRM25-260901-1808-12'), 'PRM25-260901-1808');
  // Pero el número del folio tiene cuatro cifras y es parte del folio: quitárselo
  // convertiría dos pedidos distintos en el mismo.
  assert.equal(folioBaseDe('PDG26-260909-3013'), 'PDG26-260909-3013');
  assert.equal(folioBaseDe('PRM25-260901-1808'), 'PRM25-260901-1808');
});

test('un folio sin sufijo se queda igual, y lo vacío no revienta', () => {
  assert.equal(folioBaseDe('SUELTO'), 'SUELTO');
  assert.equal(folioBaseDe(null), '');
  assert.equal(folioBaseDe(undefined), '');
});

// ---------------------------------------------------------------- la llave

test('EL BORRADO ES DE UN CLIENTE, NO DEL FOLIO', () => {
  // Mismo folio, dos clientes: son dos pedidos y tienen que tener dos llaves.
  const deAna = claveDePedido('stgo', 'F-1808', 'v1', 'ANA');
  const deLuis = claveDePedido('stgo', 'F-1808', 'v1', 'LUIS');

  assert.notEqual(deAna, deLuis);
});

test('la llave NO distingue el sufijo: es el mismo pedido', () => {
  // El cliente tiene `F-1808-2` en la base y el archivo trae `F-1808`. Es el mismo.
  assert.equal(
    claveDePedido('stgo', 'F-1808-2', 'v1', 'ANA'),
    claveDePedido('stgo', 'F-1808', 'v1', 'ANA'),
  );
});

test('distinto vendedor o distinta sucursal, distinto pedido', () => {
  const base = claveDePedido('stgo', 'F-1808', 'v1', 'ANA');

  assert.notEqual(base, claveDePedido('stgo', 'F-1808', 'v2', 'ANA'));
  assert.notEqual(base, claveDePedido('camaguey', 'F-1808', 'v1', 'ANA'));
});

test('las llaves de las notas salen tal cual para preguntar por cada fila', () => {
  const llaves = clavesDeBorrados([
    { sucursalId: 'stgo', folioBase: 'F-1808', vendedorId: 'v1', clienteId: 'ANA' },
    { sucursalId: null, folioBase: 'F-9', vendedorId: null, clienteId: null },
  ]);

  assert.equal(llaves.size, 2);
  assert.ok(llaves.has(claveDePedido('stgo', 'F-1808-1', 'v1', 'ANA')));
  // «Sin asignar» —vendedor sin gestor— también se puede borrar, y su llave existe.
  assert.ok(llaves.has(claveDePedido(null, 'F-9', null, null)));
});

// ---------------------------------------------------------------- el sufijo reservado

test('EL NÚMERO DEL BORRADO NO SE LO LLEVA OTRO', () => {
  const base = 'PRM25-260901-1808';
  // En la base viven dos: CAFETERIA 560 con el folio pelado y TCP ANA con el -1.
  const ya: FoliosYaAsignados = new Map([
    [`RAYDEL|${base}`, new Map([[claveDeCliente('CAFETERIA 560'), base]])],
  ]);

  // TCP ANA se borró a mano: su `-1` queda reservado para ella.
  reservarFoliosBorrados(ya, [nota(`${base}-1`, 'TCP ANA')], [base]);

  // Llega el archivo con la de siempre y un cliente NUEVO.
  const folios = foliosDe(
    asignarSufijos(
      [registro('RAYDEL', base, 'CAFETERIA 560'), registro('RAYDEL', base, 'EL FOCO')],
      ya,
    ),
  );

  assert.equal(folios['CAFETERIA 560'], base);
  // El nuevo NO se queda con el -1 de la borrada: coge el siguiente.
  assert.equal(folios['EL FOCO'], `${base}-2`);
});

test('y si se levanta el borrado, vuelve con SU folio', () => {
  const base = 'PRM25-260901-1808';
  const ya: FoliosYaAsignados = new Map([
    [`RAYDEL|${base}`, new Map([[claveDeCliente('CAFETERIA 560'), base]])],
  ]);

  reservarFoliosBorrados(ya, [nota(`${base}-1`, 'TCP ANA')], [base]);

  const folios = foliosDe(
    asignarSufijos(
      [registro('RAYDEL', base, 'CAFETERIA 560'), registro('RAYDEL', base, 'TCP ANA')],
      ya,
    ),
  );

  assert.equal(folios['TCP ANA'], `${base}-1`);
});

test('un pedido VIVO manda sobre una nota de borrado', () => {
  const base = 'F-1808';
  // El cliente lo tiene guardado con `-3`; la nota, vieja, decía `-1`.
  const ya: FoliosYaAsignados = new Map([
    [`RAYDEL|${base}`, new Map([[claveDeCliente('TCP ANA'), `${base}-3`]])],
  ]);

  reservarFoliosBorrados(ya, [nota(`${base}-1`, 'TCP ANA')], [base]);

  assert.equal(ya.get(`RAYDEL|${base}`)!.get(claveDeCliente('TCP ANA')), `${base}-3`);
});

test('una nota de un folio que el archivo no trae no pinta nada', () => {
  const ya: FoliosYaAsignados = new Map();

  reservarFoliosBorrados(ya, [nota('OTRO-FOLIO-1', 'TCP ANA')], ['F-1808']);

  assert.equal(ya.size, 0);
});

test('una nota sin cliente se ignora en vez de reservar a nombre de nadie', () => {
  const ya: FoliosYaAsignados = new Map();

  reservarFoliosBorrados(
    ya,
    [{ folio: 'F-1808-1', folioBase: 'F-1808', clienteNombre: null, vendedorCodigo: 'RAYDEL', vendedorNombre: 'RAYDEL' }],
    ['F-1808'],
  );

  assert.equal(ya.size, 0);
});
