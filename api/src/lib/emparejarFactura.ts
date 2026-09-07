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
 * forma parte del folio tal como está guardado. Pero OJO, porque Ventra añade uno con la
 * misma forma que significa otra cosa — ver `folioSinSufijo`.
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


/**
 * Quitarle al folio el sufijo de línea: `PDG26-260906-2992-2` → `PDG26-260906-2992`.
 *
 * # El sufijo significa DOS cosas distintas y tienen la misma forma
 *
 * Nuestra importación añade `-1`, `-2`… cuando dos clientes comparten folio en el CSV, y
 * ese sufijo **es parte del folio**: hay 2.560 pedidos así desde agosto.
 *
 * Ventra escribe otro sufijo, con la misma pinta, que es el número de documento dentro del
 * pedido: la nota `P-PDG26-260906-2992-2` es la segunda factura del pedido
 * `PDG26-260906-2992`, que en nuestra base NO lleva sufijo.
 *
 * Como se leían igual, el cotejo buscaba `PDG26-260906-2992-2` entre nuestros folios, no
 * lo encontraba, y dejaba el pedido en «sin factura» **para siempre**. Comprobado el
 * 07/09/2026 con los pedidos del día 6: tres de los cinco que tenían factura de verdad
 * estaban marcados sin ella, y los tres eran exactamente éstos.
 */
export function folioSinSufijo(folio: string): string {
  const limpio = String(folio || '').trim().toUpperCase();
  const m = /^([A-Z]{2,5}\d{2}-\d{6}-\d{1,6})-\d{1,2}$/.exec(limpio);

  return m ? m[1] : limpio;
}

/**
 * Un mapa de RESPALDO para cuando el folio de la nota no es de ningún pedido nuestro.
 *
 * # Por qué de respaldo y no a secas
 *
 * Quitarle el sufijo a todos los folios y cruzar por ahí sería volver al error de julio:
 * la factura del pedido `X-1337-1` acabaría también pegada al pedido `X-1337`, que es otro
 * pedido de otro cliente. Cuarenta de doscientas siete facturas acabaron así.
 *
 * Por eso aquí sólo entran las facturas **huérfanas**: aquellas cuyo folio exacto no es de
 * ningún pedido de los que se están cotejando. Si el folio exacto sí es de alguien, esa
 * factura ya tiene dueño y no se toca. Quien busca, mira primero el mapa exacto y sólo
 * después éste.
 *
 * Queda una ambigüedad que esto NO resuelve, y es la de antes: si existe nuestro pedido
 * `X-1337-1` y Ventra escribe `P-X-1337-1` queriendo decir «primera factura de X-1337», se
 * la lleva `X-1337-1`. No hay forma de distinguirlas mirando el texto — habría que
 * cambiar el sufijo de la importación por uno que no se confunda.
 */
export function facturasHuerfanasSinSufijo(
  porFolio: Map<string, Set<string>>,
  nuestrosFolios: Set<string>,
): Map<string, Set<string>> {
  const salida = new Map<string, Set<string>>();

  for (const [folio, facturas] of porFolio) {
    if (nuestrosFolios.has(folio)) continue;

    const base = folioSinSufijo(folio);

    if (base === folio) continue;

    const suyas = salida.get(base) ?? new Set<string>();

    for (const f of facturas) suyas.add(f);
    salida.set(base, suyas);
  }

  return salida;
}
