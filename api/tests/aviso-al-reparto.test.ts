/**
 * El aviso que PEDIDO le deja al reparto cuando cambia un pedido.
 *
 * Lo que se prueba aquí es lo que decide QUÉ se manda, que es lo que puede romperse en
 * silencio: un campo `undefined` hace que Redis rechace el aviso entero y el pedido no
 * llega nunca — y eso no da error en ningún sitio, simplemente no aparece en el reparto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  armarAviso,
  esParaElReparto,
  porDefectoDelEntorno,
  queLeCambia,
  CAMPOS_QUE_USA_EL_REPARTO,
  queHacerConLaRafaga,
} from '../src/lib/avisoAlReparto';

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

// ------------------------------------------------------ avisar por flanco, no por nivel
//
// Contado en la cola el 29/09/2026: de 2.712 pedidos avisados en tres días, sólo 295 se
// habían creado en esos tres días. Los otros ~2.400 ya eran del reparto y ya se le habían
// mandado; se volvieron a anunciar porque el cotejo les tocó un campo. Esto es lo que lo
// corta, y es la clase de cosa que se rompe sin que salte nada: si se afloja, vuelve el
// ruido; si se aprieta, hay pedidos que no salen a repartir y tampoco avisa nadie.

test('entra al camión: no era del reparto y ahora sí', () => {
  const antes = { requiere_domicilio: true, facturaEstado: null };
  const despues = { requiere_domicilio: true, facturaEstado: 'igual' };

  assert.equal(queLeCambia(antes, despues, ['facturaEstado']), 'entra');
});

test('y sale: era del reparto y deja de serlo', () => {
  const antes = { requiere_domicilio: true, facturaNumero: 'F-1' };
  const despues = { requiere_domicilio: true, facturaNumero: null, facturaEstado: 'sin_factura' };

  assert.equal(queLeCambia(antes, despues, ['facturaEstado', 'facturaNumero']), 'sale');
  // También si lo que pierde es el domicilio, no la factura: la factura dejó de cobrar la
  // entrega y nadie había marcado la casilla.
  assert.equal(
    queLeCambia(
      { facturaDomicilio: 350, facturaNumero: 'F-1' },
      { facturaDomicilio: 0, facturaNumero: 'F-1' },
      ['facturaDomicilio'],
    ),
    'sale',
  );
});

test('EL QUE IMPORTA: sigue siendo del reparto y no se le vuelve a anunciar', () => {
  // El cotejo pasa otra vez y reescribe cuándo se comprobó. Al reparto eso no le dice
  // nada: ni la carga, ni la ruta, ni el precio. Estos son los ~2.400.
  const p = { requiere_domicilio: true, facturaNumero: 'F-1', facturaEstado: 'igual' };

  assert.equal(queLeCambia(p, p, ['facturaAt']), 'nada');
  assert.equal(queLeCambia(p, p, ['facturaAt', 'facturaCorregidoAt']), 'nada');
  // `facturaDiferencias` es para pintarle al vendedor lo que la factura le cambió. No
  // mueve un camión.
  assert.equal(queLeCambia(p, p, ['facturaDiferencias']), 'nada');
  // Y sin tocar nada, menos todavía.
  assert.equal(queLeCambia(p, p, []), 'nada');
});

test('pero si le cambia lo que USA, se le dice', () => {
  const p = { requiere_domicilio: true, facturaNumero: 'F-1', facturaEstado: 'igual' };

  // Las líneas de la factura son de donde salen sus items, con los pesos: es la carga.
  assert.equal(queLeCambia(p, p, ['lineasFactura']), 'cambio');
  // El pedido se reescribió con lo facturado. Puede venir sin ningún campo más.
  assert.equal(queLeCambia(p, p, ['items']), 'cambio');
  assert.equal(queLeCambia(p, p, ['costoDomicilio']), 'cambio');
  assert.equal(queLeCambia(p, p, ['facturaDomicilio']), 'cambio');
  assert.equal(queLeCambia(p, p, ['estado']), 'cambio');
  // A dónde va y a quién se llama.
  assert.equal(queLeCambia(p, p, ['direccion']), 'cambio');
  assert.equal(queLeCambia(p, p, ['telefono']), 'cambio');
  // Uno que cuenta entre varios que no: basta ése.
  assert.equal(queLeCambia(p, p, ['facturaAt', 'facturaDiferencias', 'lineasFactura']), 'cambio');
});

test('un pedido de mostrador que se factura NO genera un «ya no va»', () => {
  // Es por esto que el `ya_no_va` no se podía sacar de la regla general mirando el nivel:
  // «no cumple la regla» es cierto para casi todos los pedidos de la casa, y habría sido
  // el ruido de antes con otro nombre. Por flanco hace falta que ANTES sí cumpliera.
  const antes = { requiere_domicilio: false, facturaEstado: null };
  const despues = { requiere_domicilio: false, facturaEstado: 'igual', facturaNumero: 'F-9' };

  assert.equal(queLeCambia(antes, despues, ['facturaEstado', 'facturaNumero']), 'nada');
});

test('llamarla con un objeto incompleto MIENTE, y calla', () => {
  // La trampa que hay que tener delante: `requiere_domicilio` faltaba en el tipo del
  // cotejo. Sin él, un pedido a domicilio marcado a mano —sin línea de ENTREGA A DOMICILIO
  // en la factura— sale «no es del reparto» a los dos lados, o sea `nada`, y deja de
  // avisarse para siempre. No falla nada: sólo hay camiones que no salen.
  assert.equal(queLeCambia({ facturaEstado: null }, { facturaEstado: 'igual' }, ['facturaEstado']), 'nada');
  // Con el campo puesto, la verdad.
  assert.equal(
    queLeCambia(
      { requiere_domicilio: true, facturaEstado: null },
      { requiere_domicilio: true, facturaEstado: 'igual' },
      ['facturaEstado'],
    ),
    'entra',
  );
});

test('lo que el reparto NO usa está fuera de la lista a propósito', () => {
  // Si alguien mete aquí un campo de los de mirar, vuelven los avisos de nada. Y si saca
  // uno de los de cargar, el reparto carga contra un dato viejo. Las dos cosas en la misma
  // lista, y por eso está escrita y no deducida.
  for (const c of ['facturaAt', 'facturaCorregidoAt', 'facturaDiferencias', 'itemsOriginal']) {
    assert.equal(CAMPOS_QUE_USA_EL_REPARTO.has(c), false, `${c} no debería contar`);
  }
  for (const c of ['lineasFactura', 'items', 'facturaNumero', 'costoDomicilio', 'requiere_domicilio']) {
    assert.equal(CAMPOS_QUE_USA_EL_REPARTO.has(c), true, `${c} sí cuenta`);
  }
});

// --------------------------------------------------------------------- la avalancha
//
// El 26/09/2026 a las 22:00 salieron 2.160 avisos en una hora, el 77 % de todo lo mandado
// en tres días, porque el cotejo repasó el catálogo viejo entero. Esto agrupa eso en uno
// por sucursal. Y como esto CALLA avisos, cada guarda de aquí es un pedido que podría
// quedarse sin repartir: se prueban todas, incluida la de no callar nunca por avería.

test('trabajando normal no se agrupa nada', () => {
  const c = { motivo: 'factura' as const, sucursalId: 'cam', id: 'p1' };

  assert.equal(queHacerConLaRafaga(c, 1, 25), 'suelto');
  assert.equal(queHacerConLaRafaga(c, 25, 25), 'suelto');
});

test('al cruzar el tope sale UNO que dice «repasa esa sucursal», y sólo uno', () => {
  const c = { motivo: 'factura' as const, sucursalId: 'cam', id: 'p1' };

  assert.equal(queHacerConLaRafaga(c, 26, 25), 'tanda');
  // Los de detrás ya no hacen falta: el reparto va a repasar la sucursal entera igual.
  assert.equal(queHacerConLaRafaga(c, 27, 25), 'callar');
  assert.equal(queHacerConLaRafaga(c, 2160, 25), 'callar');
});

test('NO SE CALLA NADA SI NO SE PUEDE CONTAR', () => {
  // Redis caído. «No se sabe» no es «son muchos»: callar un aviso por una avería de otra
  // cosa es perder un pedido, y no lo nota nadie hasta que el camión no lo lleva.
  const c = { motivo: 'factura' as const, sucursalId: 'cam', id: 'p1' };

  assert.equal(queHacerConLaRafaga(c, null, 25), 'suelto');
});

test('LOS TRES MOTIVOS QUE NUNCA SE AGRUPAN', () => {
  // Confirmado con el código del espejo el 29/09/2026: un aviso de `cliente` sin id lo
  // descartan en silencio —no tiene rama de respaldo—, y `borrado`/`ya_no_va` sin id
  // tampoco los saben leer. Agruparlos sería perderlos enteros, que es justo el fantasma
  // en el camión que estos motivos existen para evitar.
  for (const motivo of ['cliente', 'borrado', 'ya_no_va'] as const) {
    const c = { motivo, sucursalId: 'cam', id: 'x1' };

    assert.equal(queHacerConLaRafaga(c, 26, 25), 'suelto', `${motivo} no se agrupa`);
    assert.equal(queHacerConLaRafaga(c, 5000, 25), 'suelto', `${motivo} tampoco en una ráfaga larga`);
  }
});

test('los que sí se agrupan son los que el espejo sabe repasar', () => {
  for (const motivo of ['factura', 'domicilio', 'importacion'] as const) {
    assert.equal(queHacerConLaRafaga({ motivo, sucursalId: 'cam', id: 'x' }, 26, 25), 'tanda', motivo);
  }
});

test('sin sucursal no se agrupa: sería «repasa las ocho», que es peor', () => {
  assert.equal(queHacerConLaRafaga({ motivo: 'factura', sucursalId: null, id: 'p1' }, 999, 25), 'suelto');
  assert.equal(queHacerConLaRafaga({ motivo: 'factura', sucursalId: '', id: 'p1' }, 999, 25), 'suelto');
});

test('y un aviso que YA es de tanda no se vuelve a agrupar', () => {
  // `importacion` sin id ya dice «mira esa sucursal». Agruparlo otra vez sería callarlo.
  assert.equal(queHacerConLaRafaga({ motivo: 'importacion', sucursalId: 'cam', id: null }, 999, 25), 'suelto');
});
