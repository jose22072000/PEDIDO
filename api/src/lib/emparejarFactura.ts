/**
 * Atar cada factura a UN pedido, por el folio que lleva escrito en la nota.
 *
 * # El fallo que esto corrige
 *
 * Antes se emparejaba por NOMBRE DE CLIENTE, y con eso no se puede: un cliente pide el
 * lunes y el martes, y las facturas de los dos días caben en los dos pedidos. En
 * producción acabó la MISMA factura pegada a dos pedidos distintos —uno completado y otro
 * en proceso— y ninguno de los dos decía la verdad.
 *
 * El dato que sí ata una factura a un pedido concreto es el FOLIO, que va escrito en la
 * nota de la factura. Con él no hay que adivinar nada.
 *
 * # Y cuando la nota no trae folio
 *
 * No se empareja. Punto. Un pedido sin factura se ve como lo que es —«sin facturar»— y
 * alguien puede mirarlo; un pedido con la factura de otro parece correcto y nadie lo
 * mira. El segundo error es mucho peor que el primero.
 */

/** Una factura queda atada a un pedido, o a ninguno. Nunca a dos. */
export interface FacturaAtada {
  /** El número de operación de Ventra. */
  numero: string;
  /** El folio del pedido que la nota menciona. */
  folio: string;
}

/**
 * Saca el folio del pedido de la nota de una factura.
 *
 * La nota que manda Ventra viene con sus tres partes etiquetadas:
 *
 *     P-PXC25-260831-1337; V-XENIA CORDIEZ MORASEN; C-LH15TCP0295;
 *
 * `P-` es el pedido, `V-` el vendedor y `C-` el código del cliente. Se busca la etiqueta
 * `P-` y no un folio suelto: anclarse en ella evita confundirlo con cualquier otro código
 * que lleve la nota, y deja claro qué se está leyendo.
 *
 * Las facturas de mostrador vienen sin `P-` —«VENTA ALMACEN», o sólo con el vendedor— y
 * ésas no tienen pedido detrás: no se emparejan con nada, que es lo correcto. En La Habana
 * son 167 de 256 líneas las que sí lo traen.
 *
 * El sufijo `-1` que añade la importación cuando dos clientes comparten folio se conserva:
 * forma parte del folio tal como está guardado: `PAA26-260907-1828` y
 * `PAA26-260907-1828-1` son DOS pedidos, de dos clientes distintos, y cada uno tiene su
 * factura. El sufijo NUNCA se quita al cruzar.
 */
/**
 * El guion entre la fecha y el número es OPCIONAL.
 *
 * Hay dos formas del folio en producción y sólo se aceptaba una:
 *
 *     PJR25-260910-1486     la normal
 *     PAH25-2609111134      la de ALFREDO HERNANDEZ OLIVA: fecha y número pegados
 *
 * Con el guion obligatorio, la segunda no casaba y `folioDeLaNota` devolvía `null`: la
 * factura llevaba el folio escrito en su nota y se quedaba sin dueño. En septiembre,
 * CERO de 22 folios pegados cotejados contra 369 de 650 normales. Los 22 eran de
 * Alfredo, y Alfredo no tiene ni uno con el formato normal.
 *
 * El caso concreto: el pedido `PAH25-2609111134` de CAFETERIA KORYNTO, 60 packs de
 * Parranda, tiene su factura en Ventra —la 18201, 60 packs, nota
 * `P-PAH25-2609111134; V-ALFREDO HERNANDEZ OLIVA;`—. PEDIDO lo dio por `sin_factura` y
 * luego alguien lo cerró a mano. La pantalla decía «no apareció», y era verdad: la
 * buscaba con un patrón que no la podía ver.
 *
 * No se normaliza nada al comparar, y es a propósito. El folio guardado y el de la nota
 * son la MISMA cadena —los dos pegados, o los dos con guion—, así que basta con dejarlos
 * pasar. Quitar guiones para comparar sería peligroso: `PAA26-260907-1828` y
 * `PAA26-260907-1828-1` son dos pedidos de dos clientes distintos.
 */
const CUERPO = String.raw`[A-Z]{2,5}\d{2}-\d{6}-?\d{1,6}(?:-\d{1,2})?`;
const CON_ETIQUETA = new RegExp(String.raw`\bP-(${CUERPO})\b`, 'i');
/** Sin la etiqueta, por si algún día la nota viene escrita de otra forma. */
const SUELTO = new RegExp(String.raw`\b(${CUERPO})\b`, 'i');

export function folioDeLaNota(nota: string | null | undefined): string | null {
  if (!nota) return null;

  const texto = String(nota).toUpperCase();
  const m = texto.match(CON_ETIQUETA) ?? texto.match(SUELTO);

  return m ? m[1] : null;
}

/**
 * El CÓDIGO DE CLIENTE que la nota lleva escrito, en la etiqueta `C-`.
 *
 *     P-PMR25-260910-1810-5; V-MAYLEN REMON DIAZ; C-CM01TCP0649;
 *                                                   ^^^^^^^^^^^
 *
 * Es NUESTRO código —el que PEDIDO guarda en `cliente.codigo`—, no el de Ventra. Ventra
 * usa el suyo propio y numérico: ese mismo cliente es el `2608` para él. Buscar en las
 * ventas por `customerCode` con nuestro código no encuentra nunca nada, y el silencio se
 * lee como «ese cliente no compró», que es falso.
 *
 * Lo escribe PEDIDO al mandar el pedido, así que está en 1.030 de las 1.095 líneas del
 * mes. Sirve para lo que el folio solo no puede: preguntar «¿qué se le facturó a ESTE
 * cliente estos días?» cuando su pedido se quedó sin factura.
 */
const CLIENTE_EN_LA_NOTA = /(?:^|;)\s*C-([A-Z0-9][A-Z0-9\-]*)/i;

export function clienteDeLaNota(nota: string | null | undefined): string | null {
  if (!nota) return null;

  const m = String(nota).toUpperCase().match(CLIENTE_EN_LA_NOTA);

  return m ? m[1] : null;
}

export interface LineaConNota {
  operNumber: string;
  nota: string | null;
}

/**
 * De todas las líneas facturadas, qué factura corresponde a qué folio.
 *
 * Devuelve un mapa `folio -> números de factura`. Una misma factura puede aparecer en
 * varias líneas (una por producto); el folio sale de cualquiera de ellas que lo traiga.
 *
 * Si dos facturas distintas dicen el mismo folio, se quedan las dos: es un pedido que se
 * facturó en dos documentos, que pasa y es legítimo. Lo que NO puede pasar es lo
 * contrario —una factura repartida entre dos pedidos—, y por construcción aquí no ocurre:
 * cada factura menciona un folio y sólo uno.
 */
export function facturasPorFolio(lineas: LineaConNota[]): Map<string, Set<string>> {
  /** Cada factura menciona UN folio: el primero que se le vea. */
  const folioDeFactura = new Map<string, string>();

  for (const l of lineas) {
    if (!l.operNumber || folioDeFactura.has(l.operNumber)) continue;

    const folio = folioDeLaNota(l.nota);

    if (folio) folioDeFactura.set(l.operNumber, folio);
  }

  const salida = new Map<string, Set<string>>();

  for (const [numero, folio] of folioDeFactura) {
    if (!salida.has(folio)) salida.set(folio, new Set());
    salida.get(folio)!.add(numero);
  }

  return salida;
}

/**
 * De `P-PDG26-260907-2988` saca `P-PDG26-260907`: la sucursal y el día, sin el número.
 *
 * Es lo que comparten todos los pedidos de una sucursal en un día, y por eso sirve para
 * pedirle a Ventra los de todos ellos de una vez. Devuelve `null` si el folio no tiene esa
 * forma —los hay viejos y los hay escritos a mano—, y quien llama entonces pregunta por
 * fechas como siempre: quedarse sin cotejar por un folio raro sería mucho peor.
 */
export function prefijoDeFolio(folio: string): string | null {
  const partes = (folio || '').trim().toUpperCase().split('-');

  // P - nomenclador - fecha - número. Menos de cuatro trozos no es un folio nuestro.
  if (partes.length < 4 || partes[0] !== 'P') return null;
  if (!/^\d{6}$/.test(partes[2])) return null;

  return partes.slice(0, 3).join('-');
}
