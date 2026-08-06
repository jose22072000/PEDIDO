import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  nombreComparable,
  codigoComparable,
  codigoDesdeNombre,
  normalizarCodigoManual,
} from '../src/lib/nombreVendedor.ts';

/**
 * Un vendedor puede nacer por DOS caminos: el CSV que sube solo cada 5 minutos, y
 * el alta manual desde la aplicación (para quien no usa tablet). Los dos escriben
 * en el mismo sitio y la ingesta busca por ahí sin que nadie mire.
 *
 * Si los dos caminos aplanan distinto, no salta ningún error: se crea una SEGUNDA
 * ficha del mismo vendedor y sus pedidos quedan partidos entre las dos. Eso no se
 * ve hasta que cuadra mal una comisión, semanas después.
 *
 * Estas pruebas fijan que la identidad es UNA. Si alguna cae, es que se ha metido
 * una variante nueva y hay que unificar antes de desplegar.
 */

describe('nombre plano', () => {
  test('la tilde escrita de las dos formas da el MISMO nombre', () => {
    // Idénticos en pantalla, cadenas distintas: la tilde como carácter propio
    // (NFC) y como letra + tilde aparte (NFD). Esto tumbó Camagüey dos días.
    const nfc = 'GEORLIS MICHEL CÁRDENAS MORA'.normalize('NFC');
    const nfd = 'GEORLIS MICHEL CÁRDENAS MORA'.normalize('NFD');

    assert.notEqual(nfc, nfd, 'las dos formas tienen que ser cadenas distintas');
    assert.equal(nombreComparable(nfc), nombreComparable(nfd));
    assert.equal(nombreComparable(nfc), 'GEORLIS MICHEL CARDENAS MORA');
  });

  test('quita los caracteres invisibles que arrastra un encoding roto', () => {
    assert.equal(nombreComparable('ALEXANDER PADRON'), 'ALEXANDER PADRON');
    assert.equal(nombreComparable('ANDY​ ALMANZA'), 'ANDY ALMANZA');
    assert.equal(nombreComparable('﻿ANDY ALMANZA'), 'ANDY ALMANZA');
  });

  test('mayúsculas, espacios de sobra y de los bordes dan igual', () => {
    assert.equal(nombreComparable('  andy   almanza  '), 'ANDY ALMANZA');
    assert.equal(nombreComparable('Andy Almanza'), nombreComparable('ANDY ALMANZA'));
  });

  test('un nombre ya plano no cambia', () => {
    assert.equal(nombreComparable('ANDY ALMANZA'), 'ANDY ALMANZA');
  });
});

describe('código a partir del nombre', () => {
  test('coge el PRIMER APELLIDO, no el segundo nombre', () => {
    // La regla vieja cogía las 2 primeras palabras -> "glenda.melisa", que no es
    // el nombre con el que Parranda exporta el archivo. Ese vendedor acabó
    // duplicado y con 1447 pedidos en la sucursal equivocada.
    assert.equal(codigoDesdeNombre('GLENDA MELISA BLANCO ÁLVAREZ'), 'glenda.blanco');
    assert.equal(codigoDesdeNombre('DIANGO DAVID GOLA BLANCO'), 'diango.gola');
    assert.equal(codigoDesdeNombre('GEORLIS MICHEL CÁRDENAS MORA'), 'georlis.cardenas');
  });

  test('con un solo apellido coge ese', () => {
    assert.equal(codigoDesdeNombre('ALEXANDER PADRÓN'), 'alexander.padron');
  });

  test('sale SIN tildes: los archivos del Drive vienen sin ellas', () => {
    // Estos cuatro tenían el código con tilde y llevaban desde junio sin que les
    // entrara un solo pedido: el código del archivo no casaba nunca.
    assert.equal(codigoDesdeNombre('TOMÁS MANZANARES'), 'tomas.manzanares');
    assert.equal(codigoDesdeNombre('EVELYN CHARITÉ'), 'evelyn.charite');
    assert.equal(codigoDesdeNombre('ELENA BOLÍVAR'), 'elena.bolivar');
    assert.equal(codigoDesdeNombre('DANISLEY GÁMEZ'), 'danisley.gamez');
  });

  test('la tilde en NFD da el mismo código que en NFC', () => {
    const nfc = 'TOMÁS MANZANARES'.normalize('NFC');
    const nfd = 'TOMÁS MANZANARES'.normalize('NFD');

    assert.equal(codigoDesdeNombre(nfc), codigoDesdeNombre(nfd));
  });

  test('un nombre de una sola palabra no revienta', () => {
    assert.equal(codigoDesdeNombre('ALEXANDER'), 'alexander');
  });
});

describe('código tecleado a mano', () => {
  test('lo deja en la convención de todos los demás', () => {
    assert.equal(normalizarCodigoManual('  Andy.Almanza  ').codigo, 'andy.almanza');
  });

  test('el espacio invisible del final no sobrevive', () => {
    // Un código con un espacio detrás no se ve en el formulario y no casaría
    // JAMÁS con el que trae el archivo.
    assert.equal(normalizarCodigoManual('andy.almanza ').codigo, 'andy.almanza');
    assert.equal(normalizarCodigoManual('andy .almanza').codigo, 'andy.almanza');
  });

  test('la tilde se cae aquí también', () => {
    assert.equal(normalizarCodigoManual('tomás.manzanares').codigo, 'tomas.manzanares');
  });

  test('vacío se rechaza', () => {
    assert.ok(normalizarCodigoManual('').error);
    assert.ok(normalizarCodigoManual('   ').error);
    assert.ok(normalizarCodigoManual(null).error);
  });

  test('un código con caracteres raros se rechaza en vez de guardarse torcido', () => {
    assert.ok(normalizarCodigoManual('andy/almanza').error);
    assert.ok(normalizarCodigoManual('andy@almanza').error);
    assert.ok(!normalizarCodigoManual('andy_almanza-2').error);
  });
});

describe('la ingesta del CSV no cambió al sacar la regla a un módulo', () => {
  // La regla del código estaba COPIADA dentro del mapper del CSV
  // (`orderRecord.dto.ts`). Al moverla aquí, lo único que no se puede tocar es
  // lo que sale por la otra punta: si el código generado cambiara aunque fuera
  // en un caso, la próxima importación no encontraría a ese vendedor y crearía
  // un duplicado con sus pedidos partidos.
  //
  // Estos son los valores que producía el mapper ANTES del cambio, sacados de
  // los ejemplos que llevaba escritos y de los vendedores reales que ya están en
  // la base. El mapper llama ahora a `codigoDesdeNombre` y no hace nada más con
  // el código (una sola llamada, comprobada al compilar), así que fijar esta
  // función fija la ingesta.
  const casos: Array<[string, string]> = [
    ['GLENDA MELISA BLANCO ALVAREZ', 'glenda.blanco'],
    ['DIANGO DAVID GOLA BLANCO', 'diango.gola'],
    ['ALEXANDER PADRON', 'alexander.padron'],
    ['GEORLIS MICHEL CARDENAS MORA', 'georlis.cardenas'],
    ['ANDY ALMANZA', 'andy.almanza'],
    ['TOMAS MANZANARES', 'tomas.manzanares'],
    ['DANISLEY GAMEZ', 'danisley.gamez'],
  ];

  for (const [nombre, esperado] of casos) {
    test(`"${nombre}" -> ${esperado}`, () => {
      assert.equal(codigoDesdeNombre(nombre), esperado);
    });
  }
});

describe('los DOS caminos tienen que dar la misma identidad', () => {
  // Lo que de verdad importa: dar de alta a mano a alguien y que, cuando meses
  // después empiece a llegar su CSV, ese archivo caiga sobre la ficha que ya
  // existe en vez de crear una segunda.
  const personas = [
    { manual: 'Georlis Michel Cárdenas Mora', csv: 'GEORLIS MICHEL CARDENAS MORA' },
    { manual: 'glenda melisa blanco álvarez', csv: 'GLENDA MELISA BLANCO ALVAREZ' },
    { manual: 'Tomás Manzanares', csv: 'TOMAS MANZANARES' },
    { manual: 'Alexander Padrón', csv: 'ALEXANDER PADRON' },
  ];

  for (const p of personas) {
    test(`"${p.manual}" tecleado = "${p.csv}" del archivo`, () => {
      assert.equal(nombreComparable(p.manual), nombreComparable(p.csv));
      assert.equal(codigoDesdeNombre(p.manual), codigoDesdeNombre(p.csv));

      // Y el código que se guardaría al darlo de alta es el que la ingesta
      // buscará: si esto falla, duplicado seguro.
      const guardado = normalizarCodigoManual(codigoDesdeNombre(p.manual)).codigo;

      assert.equal(codigoComparable(guardado), codigoDesdeNombre(p.csv));
    });
  }
});
