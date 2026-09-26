/**
 * El aviso que PEDIDO le deja al reparto cuando cambia un pedido.
 *
 * Lo que se prueba aquí es lo que decide QUÉ se manda, que es lo que puede romperse en
 * silencio: un campo `undefined` hace que Redis rechace el aviso entero y el pedido no
 * llega nunca — y eso no da error en ningún sitio, simplemente no aparece en el reparto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { armarAviso, esParaElReparto, porDefectoDelEntorno } from '../src/lib/avisoAlReparto';

// ------------------------------------------------------------------ el interruptor
//
// El de verdad vive en la base y se toca desde la pantalla de Sincronización; eso no se
// prueba aquí porque necesita base. Lo que sí se prueba es el valor POR DEFECTO, el que
// manda mientras nadie haya tocado la pantalla: una instalación nueva no puede ponerse a
// avisar sola porque alguien dejara un `DELIVERY_EVENTS=0` por ahí.

test('apagado por defecto: sin la variable, PEDIDO se comporta como antes', () => {
  assert.equal(porDefectoDelEntorno({}), false);
  assert.equal(porDefectoDelEntorno({ DELIVERY_EVENTS: '' }), false);
  assert.equal(porDefectoDelEntorno({ DELIVERY_EVENTS: 'false' }), false);
  // Un `0` o un `si` heredados de otro sitio no lo encienden: sólo «true».
  assert.equal(porDefectoDelEntorno({ DELIVERY_EVENTS: '0' }), false);
  assert.equal(porDefectoDelEntorno({ DELIVERY_EVENTS: 'si' }), false);
});

test('y encendido con «true», aunque venga con mayúsculas o espacios', () => {
  assert.equal(porDefectoDelEntorno({ DELIVERY_EVENTS: 'true' }), true);
  assert.equal(porDefectoDelEntorno({ DELIVERY_EVENTS: ' TRUE ' }), true);
});

// ------------------------------------------------------------------ el contenido

test('el aviso lleva lo justo para saber qué pedir, y POR QUÉ', () => {
  const a = armarAviso({ id: 'abc', sucursalId: 'cam', motivo: 'factura', accion: 'cambiado' }, () => 1700);

  assert.deepEqual(a, {
    entidad: 'pedido',
    motivo: 'factura',
    accion: 'cambiado',
    id: 'abc',
    sucursalId: 'cam',
    ts: '1700',
  });
});

test('los cuatro motivos son los que el reparto sabe atender', () => {
  // Si aparece uno nuevo, el consumidor tiene que aprender qué hacer con él: que la
  // lista viva en un sitio es lo que evita que se invente un motivo por el camino.
  for (const motivo of ['factura', 'domicilio', 'importacion', 'borrado'] as const) {
    assert.equal(armarAviso({ motivo }, () => 1).motivo, motivo);
  }
});

test('NINGÚN CAMPO PUEDE IR VACÍO DE VERDAD', () => {
  // Con un `undefined` o un `null` dentro, Redis rechaza el XADD completo y el aviso no
  // se manda: el pedido no llega al reparto y no hay error en ninguna parte.
  const a = armarAviso({ motivo: 'factura' }, () => 1);

  for (const [campo, valor] of Object.entries(a)) {
    assert.equal(typeof valor, 'string', `${campo} tiene que ser texto, es ${typeof valor}`);
    assert.notEqual(valor, undefined);
  }
  assert.equal(a.id, '');
  assert.equal(a.sucursalId, '');
});

test('un aviso de tanda va sin id: es «mira esta sucursal entera»', () => {
  const a = armarAviso({ sucursalId: 'stgo', motivo: 'importacion', accion: 'bulk' }, () => 2);

  assert.equal(a.id, '');
  assert.equal(a.accion, 'bulk');
  assert.equal(a.sucursalId, 'stgo');
});

test('sin acción, «change»: nunca se manda un aviso sin decir qué pasó', () => {
  assert.equal(armarAviso({ id: 'x', motivo: 'factura' }, () => 3).accion, 'change');
});

test('la hora va en texto y en milisegundos, para poder medir el retraso', () => {
  const a = armarAviso({ id: 'x', motivo: 'domicilio' }, () => 1_759_000_000_000);

  assert.equal(a.ts, '1759000000000');
  assert.ok(Number(a.ts) > 0);
});

// ------------------------------------------------------------------ a quién le toca
//
// Esta es LA regla: qué sale de PEDIDO hacia el reparto. Equivocarse por el lado flojo
// llena la cola de ruido —y volvemos al barrido que veníamos a quitar—; por el lado
// estricto, deja pedidos sin repartir y no avisa nadie. Las dos formas de fallar son
// caras y ninguna se ve en una pantalla.

test('le toca: va a domicilio Y ya tiene factura', () => {
  assert.equal(esParaElReparto({ requiere_domicilio: true, facturaNumero: 'F-1' }), true);
  // El cotejo ya dijo lo suyo: vale igual que traer el número.
  assert.equal(esParaElReparto({ requiere_domicilio: true, facturaEstado: 'igual' }), true);
  assert.equal(esParaElReparto({ requiere_domicilio: true, facturaEstado: 'cambiado' }), true);
});

test('la factura manda sobre la casilla: si se cobró la entrega, se entrega', () => {
  // Nadie marcó `requiere_domicilio`, pero la factura trae la línea de ENTREGA A
  // DOMICILIO. Sale de lo que se cobró, no de lo que alguien marcó al tomar el pedido.
  assert.equal(esParaElReparto({ facturaDomicilio: 350, facturaNumero: 'F-2' }), true);
  // Cobrada en cero no es cobrada.
  assert.equal(esParaElReparto({ facturaDomicilio: 0, facturaNumero: 'F-2' }), false);
});

test('no le toca: de mostrador, o sin facturar todavía', () => {
  // De mostrador, aunque esté facturadísimo.
  assert.equal(esParaElReparto({ requiere_domicilio: false, facturaNumero: 'F-3' }), false);
  // A domicilio pero sin factura: no se carga un camión con lo que no se sabe qué es.
  assert.equal(esParaElReparto({ requiere_domicilio: true }), false);
  // `sin_factura` es «se comprobó y no la tiene», que no es tenerla.
  assert.equal(esParaElReparto({ requiere_domicilio: true, facturaEstado: 'sin_factura' }), false);
  // Recién entrado por CSV: ni una cosa ni la otra.
  assert.equal(esParaElReparto({}), false);
  assert.equal(esParaElReparto(null), false);
});

test('los nulos de la base no cuentan como un sí', () => {
  // Prisma devuelve `null`, no `undefined`, y un `null` colándose por un `||` sería
  // justo el fallo por el lado flojo: avisar de todo.
  assert.equal(
    esParaElReparto({
      requiere_domicilio: null,
      facturaDomicilio: null,
      facturaNumero: null,
      facturaEstado: null,
    }),
    false,
  );
});

// ------------------------------------------------------ comparar ids de un stream
//
// Los ids son `<milisegundos>-<n>`. Se comparan para saber si lo que el tope tiró
// incluía avisos que el reparto no había leído, y ahí un `>` entre cadenas miente:
// `"9-0" > "10-0"` es cierto en texto y falso de verdad. Con milisegundos eso pasa en
// cuanto cambia el número de cifras, o sea el día que menos se espera.

test('un id de stream se compara por número, no como texto', () => {
  const mayorQue = (a: string, b: string): boolean => {
    const [am, an] = a.split('-').map(Number);
    const [bm, bn] = b.split('-').map(Number);

    if (!Number.isFinite(am) || !Number.isFinite(bm)) return false;

    return am !== bm ? am > bm : (an || 0) > (bn || 0);
  };

  // El que caza el fallo: en texto, "9" va después de "10".
  assert.equal(mayorQue('9-0', '10-0'), false);
  assert.equal(mayorQue('10-0', '9-0'), true);
  // Mismo milisegundo: manda el contador.
  assert.equal(mayorQue('1790443186657-2', '1790443186657-1'), true);
  assert.equal(mayorQue('1790443186657-1', '1790443186657-2'), false);
  // Iguales no es mayor: si lo tirado es justo lo último entregado, se leyó.
  assert.equal(mayorQue('1790443186657-0', '1790443186657-0'), false);
  // `0-0` es «no se ha tirado nada»: nunca puede ser mayor que algo entregado.
  assert.equal(mayorQue('0-0', '1790443186657-0'), false);
  // Basura no dispara la alarma.
  assert.equal(mayorQue('', '1-0'), false);
});
