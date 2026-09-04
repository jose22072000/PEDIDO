/**
 * Cotejar el pedido con la factura.
 *
 * Es lo que decide qué sale en el camión. Si dice «igual» cuando no lo es, se carga de
 * más y se cobra de menos; si dice «cambiado» cuando sí cuadra, ese pedido se queda sin
 * repartir. Las dos cosas se ven al final del día, y para entonces ya pasó.
 */
import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cotejar, mismoProducto, clavesDeProducto, unidadesPorFormato } from '../src/lib/cotejarFactura.ts'

// Los nombres REALES: Ventra escribe el formato en mililitros y el pedido en litros.
const FACTURA = [
  { operNumber: '1024160', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', cantidad: 20 },
  { operNumber: '1024160', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'MALTA GUAJIRA 1500 ML BLISTER 6U', cantidad: 10 },
]

test('«PARRANDA 1.5L» y «CERVEZA PARRANDA 1500 ML BLISTER 6U» son el mismo producto', () => {
  assert.ok(mismoProducto('PARRANDA 1.5L', 'CERVEZA PARRANDA 1500 ML BLISTER 6U'))
  assert.ok(clavesDeProducto('PARRANDA 1.5L').has('1500'), 'el litro no se pasó a mililitros')
})

test('pero NO confunde formatos de la misma marca', () => {
  // Con una sola palabra en común —«parranda»— casaría cualquier formato con cualquiera,
  // y el cotejo diría que cuadra cuando lo que se lleva es otra cosa.
  assert.equal(mismoProducto('PARRANDA 0.33L', 'CERVEZA PARRANDA 1500 ML BLISTER 6U'), false)
})

test('lo que cuadra sale como igual, con su número de factura', () => {
  const r = cotejar(
    [
      { producto: 'PARRANDA 1.5L', packs: 20, unidades: 120 },
      { producto: 'MALTA GUAJIRA 1.5L', packs: 10, unidades: 60 },
    ],
    FACTURA,
  )

  assert.equal(r.estado, 'igual')
  assert.equal(r.numero, '1024160')
  assert.deepEqual(r.diferencias, [])
})

test('lo que cambió lo DICE, con las cantidades de los dos lados', () => {
  const r = cotejar([{ producto: 'PARRANDA 1.5L', packs: 25 }], FACTURA)

  assert.equal(r.estado, 'cambiado')
  // Y se dice en qué: se pidieron 25 y se facturaron 20. Sin eso, «cambiado» a secas
  // obliga a abrir Ventra para saber qué pasó.
  assert.match(r.diferencias.join(' | '), /pedido 25, facturado 20/)
  // Lo facturado y no pedido también cuenta.
  assert.match(r.diferencias.join(' | '), /MALTA GUAJIRA .*facturado 10, no pedido/)
})

test('sin ninguna factura suya, se dice: no se inventa un encaje', () => {
  /**
   * De quién es cada factura ya no se decide aquí: lo decide el folio de la nota, en
   * `emparejarFactura`. Aquí sólo llegan las que son de ESTE pedido, y cuando no hay
   * ninguna se dice, en vez de buscarle una parecida.
   */
  const r = cotejar([{ producto: 'PARRANDA 1.5L', packs: 20 }], [])

  assert.equal(r.estado, 'sin_factura')
  assert.equal(r.numero, null)
})

test('dos facturas del mismo cliente el mismo día se cotejan JUNTAS', () => {
  /**
   * Pasa cuando el pedido se factura en dos documentos. Compararlo contra una sola diría
   * «cambiado» siempre, y media ruta se quedaría fuera.
   */
  const dos = [
    ...FACTURA,
    { operNumber: '1024199', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'ARROZ CAMIL 1 KG PACA 10U', cantidad: 5 },
  ]
  const r = cotejar(
    [
      { producto: 'PARRANDA 1.5L', packs: 20 },
      { producto: 'MALTA GUAJIRA 1.5L', packs: 10 },
      { producto: 'ARROZ CAMIL 1 KG', packs: 5 },
    ],
    dos,
  )

  assert.equal(r.estado, 'igual')
  assert.equal(r.numero, '1024160, 1024199')
})

// ---------------------------------------------------- el cobro del reparto no es carga

test('la línea de ENTREGA A DOMICILIO no cuenta como mercancía', () => {
  /**
   * Ventra factura el reparto como una línea más. Dejándola dentro, TODOS los pedidos a
   * domicilio salían «cambiados» —esa línea nunca está en el pedido—, y encima se copiaba
   * al pedido como si fuera algo que hay que subir al camión.
   */
  const r = cotejar(
    [{ producto: 'PARRANDA 1.5L', packs: 20, unidades: 120 }],
    [
      { operNumber: '99', clienteNombre: 'LA CHIQUI', productoNombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', cantidad: 20 },
      { operNumber: '99', clienteNombre: 'LA CHIQUI', productoNombre: 'ENTREGA A DOMICILIO', cantidad: 1, precioUsd: 4.5 },
    ],
  )

  assert.equal(r.estado, 'igual', 'el domicilio facturado no puede convertir el pedido en «cambiado»')
  assert.equal(r.lineas.length, 1, 'sólo la mercancía')
  // Y lo que cobró sí se guarda: es lo que de verdad pagó el cliente por el reparto.
  assert.equal(r.domicilioFacturado, 4.5)
})

test('sin línea de domicilio, no se inventa un cobro', () => {
  const r = cotejar(
    [{ producto: 'PARRANDA 1.5L', packs: 20, unidades: 120 }],
    [{ operNumber: '99', clienteNombre: 'LA CHIQUI', productoNombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', cantidad: 20 }],
  )

  // null y no cero: cero se lee como «se repartió gratis», y esto es «se recogió».
  assert.equal(r.domicilioFacturado, null)
})

/**
 * Productos de la MISMA familia, que sólo se diferencian en el sabor o la marca.
 *
 * Es el fallo que vio Amado el 04/09/2026: un pedido idéntico a su factura salía
 * «cambiado» con dos diferencias inventadas, sólo porque la factura listaba los
 * productos en otro orden.
 */
describe('familias de productos que se parecen mucho', () => {
  const refrescos = (nombre: string, packs: number, codigo?: string) => ({
    producto: nombre, packs, unidades: packs * 24, codigo: codigo ?? null,
  });
  const facturado = (nombre: string, cantidad: number, codigo?: string) => ({
    operNumber: '43455', clienteNombre: 'X', productoNombre: nombre,
    productoCodigo: codigo ?? null, cantidad, precioUsd: 1,
  });

  it('el ORDEN de la factura no cambia el resultado', () => {
    // Tres refrescos que comparten cinco palabras: refresco, santa, 330, caja, 24u.
    const pedido = [
      refrescos('REFRESCO REFRESCO SANTA ORANGE 330ML CAJA 24U', 8),
      refrescos('REFRESCO REFRESCO SANTA COLA 330ML CAJA 24U', 5),
      refrescos('REFRESCO REFRESCO SANTA PINA 330ML CAJA 24U', 7),
    ];
    // La factura los lista al revés, que es lo que rompía.
    const factura = [
      facturado('REFRESCO SANTA PINA 330 ML CAJA 24U', 7),
      facturado('REFRESCO SANTA COLA 330 ML CAJA 24U', 5),
      facturado('REFRESCO SANTA ORANGE 330 ML CAJA 24U', 8),
    ];
    const r = cotejar(pedido, factura);

    assert.deepEqual(r.diferencias, []);
    assert.equal(r.estado, 'igual');
  });

  it('y si de verdad cambia una cantidad, se dice de CUÁL', () => {
    const r = cotejar(
      [refrescos('REFRESCO REFRESCO SANTA ORANGE 330ML CAJA 24U', 8),
       refrescos('REFRESCO REFRESCO SANTA PINA 330ML CAJA 24U', 7)],
      [facturado('REFRESCO SANTA PINA 330 ML CAJA 24U', 7),
       facturado('REFRESCO SANTA ORANGE 330 ML CAJA 24U', 3)],
    );

    assert.equal(r.diferencias.length, 1);
    assert.match(r.diferencias[0], /ORANGE.*pedido 8, facturado 3/);
  });

  it('el mismo arroz de dos marcas no se confunde', () => {
    const r = cotejar(
      [{ producto: 'ALIMENTOS ARROZ RIVIERA 1 KG PACA 10U', packs: 10, unidades: 100 }],
      [facturado('ARROZ PATEKO 1 KG PACA 10U', 10),
       facturado('ARROZ RIVIERA 1 KG PACA 10U', 10)],
    );

    // RIVIERA cuadra; PATEKO sobra y se dice.
    assert.equal(r.diferencias.length, 1);
    assert.match(r.diferencias[0], /PATEKO.*no pedido/);
  });

  it('el mismo aceite en dos tamanos tampoco', () => {
    const r = cotejar(
      [{ producto: 'ACEITE SOYA SAUDE 900 ML CAJA 20U', packs: 4, unidades: 80 }],
      [facturado('ACEITE SOYA SAUDE 500 ML CAJA 20U', 9),
       facturado('ACEITE SOYA SAUDE 900 ML CAJA 20U', 4)],
    );

    assert.equal(r.diferencias.length, 1);
    assert.match(r.diferencias[0], /500.*no pedido/);
  });

  it('el CODIGO manda sobre el parecido del nombre', () => {
    // Ventra escribe los nombres a su manera. Cuando los dos lados traen codigo, no hay
    // nada que interpretar.
    const r = cotejar(
      [refrescos('REFRESCO PARRANDA 1.5L', 5, 'PARR0003')],
      [facturado('CERVEZA PARRANDA 1500 ML BLISTER 6U', 5, 'PARR0003')],
    );

    assert.deepEqual(r.diferencias, []);
  });

  it('dos candidatas empatadas NO se eligen a cara o cruz', () => {
    // Si no se puede distinguir, se dice. Acertar a medias es como se pierde mercancia.
    const r = cotejar(
      [{ producto: 'REFRESCO SANTA 330 ML CAJA 24U', packs: 5, unidades: 120 }],
      [facturado('REFRESCO SANTA COLA 330 ML CAJA 24U', 5),
       facturado('REFRESCO SANTA PINA 330 ML CAJA 24U', 5)],
    );

    assert.ok(r.diferencias.length >= 1);
  });
});

describe('cuantas unidades trae un formato, leido del nombre', () => {
  it('lo dice el propio nombre, casi siempre', () => {
    assert.equal(unidadesPorFormato('REFRESCO SANTA PINA 330 ML CAJA 24U'), 24);
    assert.equal(unidadesPorFormato('CERVEZA PARRANDA 1500 ML BLISTER 6U'), 6);
    assert.equal(unidadesPorFormato('ARROZ RIVIERA 1 KG PACA 10U'), 10);
  });

  it('los dos pisos: 12 paquetes de 4 son 48, no 4', () => {
    // Mirando solo la «U» final saldria 4, y el numero quedaria doce veces corto.
    assert.equal(unidadesPorFormato('PAPEL HIGIENICO LIRIO 44 M PACA 12P DE 4U'), 48);
  });

  it('lo que no lo dice se queda en nulo, no en uno', () => {
    // Suponer «1» es inventarse una cifra que despues alguien suma.
    assert.equal(unidadesPorFormato('ARROZ BLANCO 25 KG SACO'), null);
    assert.equal(unidadesPorFormato('QUESO GOUDA LITUANO BARRA'), null);
    assert.equal(unidadesPorFormato(''), null);
  });
});

/**
 * Cada línea dice cómo quedó frente al pedido.
 *
 * Es lo que la pantalla pinta al lado de cada producto de la factura. Si una línea
 * añadida sale como «igual», quien mira el pedido cree que el cliente pidió algo que
 * nunca pidió; y si la que cambió no se marca, la diferencia hay que buscarla leyendo
 * dos listas — que es exactamente lo que esto viene a quitar.
 */
describe('cada linea sale marcada', () => {
  const pedido = [
    { producto: 'REFRESCO SANTA COLA 330ML CAJA 24U', packs: 6, unidades: 144 },
    { producto: 'REFRESCO SANTA ORANGE 330ML CAJA 24U', packs: 6, unidades: 144 },
    { producto: 'DETERGENTE KAPITAL 1 KG PACA 12U', packs: 5, unidades: 60 },
  ];
  const factura = [
    { operNumber: '43511', clienteNombre: 'X', productoNombre: 'REFRESCO SANTA COLA 330 ML CAJA 24U', cantidad: 6, precioUsd: 13.92 },
    { operNumber: '43511', clienteNombre: 'X', productoNombre: 'REFRESCO SANTA ORANGE 330 ML CAJA 24U', cantidad: 2, precioUsd: 13.92 },
    { operNumber: '43511', clienteNombre: 'X', productoNombre: 'MALTA GUAJIRA 1500 ML BLISTER 6U', cantidad: 4, precioUsd: 9.90 },
  ];
  const marca = (r: ReturnType<typeof cotejar>, trozo: string) =>
    r.lineas.find((l) => l.producto.includes(trozo))?.marca;

  it('lo que cuadra es igual, lo que no cuadra es cambio, lo que sobra es nuevo', () => {
    const r = cotejar(pedido, factura);

    assert.equal(marca(r, 'COLA'), 'igual');
    assert.equal(marca(r, 'ORANGE'), 'cambio');
    assert.equal(marca(r, 'MALTA'), 'nuevo');
  });

  it('la que cambio dice CUANTAS se pidieron', () => {
    // Sin esto la nota diria «2 formatos» y no habria con que compararlo.
    const r = cotejar(pedido, factura);

    assert.equal(r.lineas.find((l) => l.producto.includes('ORANGE'))?.pedido, 6);
    assert.equal(r.lineas.find((l) => l.producto.includes('MALTA'))?.pedido, null);
  });

  it('lo pedido que no se facturo sale en faltantes, NO en lineas', () => {
    /**
     * Aparte a proposito: `lineas` es lo que reescribe el pedido cuando se corrige, y un
     * producto de cero formatos ahi acabaria subiendo al camion como un articulo de cero.
     */
    const r = cotejar(pedido, factura);

    assert.deepEqual(r.faltantes, [{ producto: 'DETERGENTE KAPITAL 1 KG PACA 12U', pedido: 5 }]);
    assert.ok(!r.lineas.some((l) => l.producto.includes('KAPITAL')), 'no puede colarse en las lineas');
  });

  it('cuando todo cuadra, todas son iguales y no falta nada', () => {
    const r = cotejar(
      [{ producto: 'REFRESCO SANTA COLA 330ML CAJA 24U', packs: 6, unidades: 144 }],
      [factura[0]],
    );

    assert.equal(r.estado, 'igual');
    assert.deepEqual(r.faltantes, []);
    assert.deepEqual(r.lineas.map((l) => l.marca), ['igual']);
  });

  it('la linea del domicilio no se marca: no es mercancia', () => {
    const r = cotejar(
      [{ producto: 'REFRESCO SANTA COLA 330ML CAJA 24U', packs: 6, unidades: 144 }],
      [factura[0], { operNumber: '43511', clienteNombre: 'X', productoNombre: 'ENTREGA A DOMICILIO', cantidad: 1, precioUsd: 12 }],
    );

    assert.equal(r.lineas.length, 1, 'el domicilio no puede salir como un producto mas');
    assert.equal(r.domicilioFacturado, 12);
  });
});
