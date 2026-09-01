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
 * Los folios tienen la forma `PMH25-260901-1001`: tres o cuatro letras, dos dígitos,
 * guion, la fecha, guion y el número. Puede venir suelto en la nota, con texto alrededor
 * o con un sufijo `-1` de los que añade la propia importación cuando dos clientes
 * comparten folio; el sufijo se conserva porque forma parte del folio guardado.
 */
const FOLIO = /\b([A-Z]{2,5}\d{2}-\d{6}-\d{1,6}(?:-\d{1,2})?)\b/i;

export function folioDeLaNota(nota: string | null | undefined): string | null {
  if (!nota) return null;

  const m = String(nota).toUpperCase().match(FOLIO);

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
