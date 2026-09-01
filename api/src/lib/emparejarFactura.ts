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
 * forma parte del folio tal como está guardado.
 */
const CUERPO = String.raw`[A-Z]{2,5}\d{2}-\d{6}-\d{1,6}(?:-\d{1,2})?`;
const CON_ETIQUETA = new RegExp(String.raw`\bP-(${CUERPO})\b`, 'i');
/** Sin la etiqueta, por si algún día la nota viene escrita de otra forma. */
const SUELTO = new RegExp(String.raw`\b(${CUERPO})\b`, 'i');

export function folioDeLaNota(nota: string | null | undefined): string | null {
  if (!nota) return null;

  const texto = String(nota).toUpperCase();
  const m = texto.match(CON_ETIQUETA) ?? texto.match(SUELTO);

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
