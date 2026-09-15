/**
 * El reparto del domicilio por grupo de productos, y que cuadre con el total.
 *
 * Se prueba porque es lo único de la integración que decide DINERO con lo que manda un
 * tercero, y cuando se equivoca no rompe nada: un total que no cuadra con sus grupos deja
 * una factura de Procovar o de Ces con un domicilio que no es el que se cobró, y eso no
 * se ve hasta que alguien suma a mano.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolverTotalDomicilio, normalizarGrupos } from '../src/lib/domicilioGrupos';

const PROCOVAR_Y_CES = [
  { grupo: 'Procovar', entrega: 15.0 },
  { grupo: 'Ces...', entrega: 50.0 },
];

test('el ejemplo real de la APK: dos grupos que suman el total', () => {
  const r = resolverTotalDomicilio(65.0, PROCOVAR_Y_CES);
  assert.equal(r.motivo, null);
  assert.equal(r.costo, 65.0);
  // Cada grupo sale con su pedido en nulo: este domicilio es de uno solo.
  assert.deepEqual(r.grupos, [
    { grupo: 'Procovar', entrega: 15.0, productos: null, pedidoId: null, folio: null },
    { grupo: 'Ces...', entrega: 50.0, productos: null, pedidoId: null, folio: null },
  ]);
});

test('sin total, el total es la suma de los grupos', () => {
  // Es la definición, no una suposición: `total` es Σ grupos[].entrega.
  const r = resolverTotalDomicilio(null, PROCOVAR_Y_CES);
  assert.equal(r.motivo, null);
  assert.equal(r.costo, 65.0);
});

test('si el total NO cuadra con los grupos, no se elige: se rechaza', () => {
  // Cobrar 99 y publicar un desglose que suma 65 es dinero mal puesto de las dos formas.
  const r = resolverTotalDomicilio(99.0, PROCOVAR_Y_CES);
  assert.equal(r.costo, null);
  assert.match(r.motivo!, /no cuadra/);
  // El motivo lleva las dos cifras: sin ellas no se puede decir cuál de los dos lados falla.
  assert.match(r.motivo!, /99\.00/);
  assert.match(r.motivo!, /65\.00/);
});

test('un céntimo de diferencia es redondeo, no un error', () => {
  // Los dos lados redondean a dos decimales por su cuenta.
  assert.equal(resolverTotalDomicilio(65.01, PROCOVAR_Y_CES).motivo, null);
  assert.equal(resolverTotalDomicilio(64.99, PROCOVAR_Y_CES).motivo, null);
  // Dos céntimos ya no.
  assert.match(resolverTotalDomicilio(65.02, PROCOVAR_Y_CES).motivo!, /no cuadra/);
});

test('el formato viejo sigue entrando: costo suelto y sin grupos', () => {
  // Mientras su backend no corte, llega `costo` y nada más. No se rompe.
  const r = resolverTotalDomicilio(14.44, null);
  assert.equal(r.motivo, null);
  assert.equal(r.costo, 14.44);
  assert.equal(r.grupos, null);
});

test('un total que falta NO es un cero', () => {
  // Un domicilio en cero parece un domicilio gratis y nadie lo mira; un rechazo se ve.
  assert.match(resolverTotalDomicilio(null, null).motivo!, /no es un número válido/);
  assert.match(resolverTotalDomicilio('', null).motivo!, /no es un número válido/);
  assert.match(resolverTotalDomicilio(undefined, []).motivo!, /no es un número válido/);
  // Pero un cero puesto a propósito sí vale.
  assert.equal(resolverTotalDomicilio(0, null).motivo, null);
});

test('dos grupos con el mismo nombre se rechazan: uno pisaría al otro', () => {
  // La clave de la tabla es (pedido, grupo). Sin esto, el segundo borra al primero y el
  // desglose acabaría sumando menos que el total, en silencio.
  const r = resolverTotalDomicilio(30, [
    { grupo: 'Procovar', entrega: 15 },
    { grupo: 'Procovar', entrega: 15 },
  ]);
  assert.match(r.motivo!, /nombre distinto/);
});

test('un grupo sin nombre, o con entrega negativa, no entra', () => {
  assert.match(resolverTotalDomicilio(15, [{ grupo: '  ', entrega: 15 }]).motivo!, /grupos/);
  assert.match(resolverTotalDomicilio(-5, [{ grupo: 'Procovar', entrega: -5 }]).motivo!, /grupos/);
});

test('"Sin grupo" es un grupo como otro cualquiera', () => {
  // Es lo que manda la APK para las entregas sin etiqueta: tiene que poder guardarse.
  const r = resolverTotalDomicilio(15, [{ grupo: 'Sin grupo', entrega: 15 }]);
  assert.equal(r.motivo, null);
  assert.deepEqual(r.grupos, [
    { grupo: 'Sin grupo', entrega: 15, productos: null, pedidoId: null, folio: null },
  ]);
});

test('sin grupos es null, y no una lista vacía', () => {
  // Son dos cosas distintas: "formato viejo" frente a "mandaron un desglose vacío".
  assert.equal(normalizarGrupos(null), null);
  assert.equal(normalizarGrupos([]), null);
  assert.equal(normalizarGrupos('Procovar'), 'invalido');
});

/**
 * Un domicilio que cubre DOS pedidos.
 *
 * La pantalla de la APK del 15/09/2026: mismo cliente, mismo vendedor, mismo viaje, y
 * dos pedidos — CES en Ped56434 por $0.40 y PROCOVAR en Ped67545 por $0.07. Si esto se
 * lee en plano, los $0.47 enteros van al pedido de la cabecera: uno cobra de más y el
 * otro se queda sin domicilio, y ninguno de los dos parece un error desde ninguna
 * pantalla.
 */
import { repartoDeGrupos } from '../src/lib/domicilioGrupos';

test('cada grupo con su pedido: el domicilio se reparte, no se acumula', () => {
  const r = resolverTotalDomicilio(0.47, [
    { grupo: 'CES', entrega: 0.4, pedidoId: 'ped56434' },
    { grupo: 'PROCOVAR', entrega: 0.07, pedidoId: 'ped67545' },
  ]);
  assert.equal(r.motivo, null);
  assert.equal(r.costo, 0.47);
  assert.equal(repartoDeGrupos(r.grupos), 'porGrupo');
  // Y cada parte sabe a qué pedido va.
  assert.equal(r.grupos![0].pedidoId, 'ped56434');
  assert.equal(r.grupos![1].pedidoId, 'ped67545');
});

test('sin pedido por grupo, el domicilio entero es del pedido de la cabecera', () => {
  const r = resolverTotalDomicilio(65, PROCOVAR_Y_CES);
  assert.equal(repartoDeGrupos(r.grupos), 'entero');
});

test('unos grupos con pedido y otros sin él NO se reparten a ojo', () => {
  // Sin saber a qué pedido va la parte huérfana, cualquier reparto es inventado.
  const mezcla = repartoDeGrupos([
    { grupo: 'CES', entrega: 0.4, pedidoId: 'ped56434' },
    { grupo: 'PROCOVAR', entrega: 0.07 },
  ]);
  assert.equal(mezcla, 'mezclado');
});

test('el folio vale igual que el id para señalar el pedido de un grupo', () => {
  const r = resolverTotalDomicilio(0.47, [
    { grupo: 'CES', entrega: 0.4, folio: 'POR26-260915-1' },
    { grupo: 'PROCOVAR', entrega: 0.07, folio: 'POR26-260915-2' },
  ]);
  assert.equal(repartoDeGrupos(r.grupos), 'porGrupo');
});

test('el subtotal de productos del grupo se guarda, y no entra en el cuadre del total', () => {
  // La pantalla del 15/09: CES $54.00 de productos + $0.40 de domicilio; PROCOVAR $45.18
  // + $0.07. `total` sigue siendo 0.47 — sólo las entregas.
  const r = resolverTotalDomicilio(0.47, [
    { grupo: 'CES', entrega: 0.4, productos: 54.0, pedidoId: 'ped56434' },
    { grupo: 'PROCOVAR', entrega: 0.07, productos: 45.18, pedidoId: 'ped67545' },
  ]);
  assert.equal(r.motivo, null);
  assert.equal(r.costo, 0.47);
  assert.equal(r.grupos![0].productos, 54.0);
  assert.equal(r.grupos![1].productos, 45.18);
});

test('no mandar el subtotal de productos no es mandarlo en cero', () => {
  const r = resolverTotalDomicilio(15, [{ grupo: 'Procovar', entrega: 15 }]);
  assert.equal(r.grupos![0].productos, null);
  // Y un importe negativo no es un dato dudoso: es falso.
  assert.match(resolverTotalDomicilio(15, [{ grupo: 'P', entrega: 15, productos: -1 }]).motivo!, /grupos/);
});
