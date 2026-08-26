/**
 * Cruzar los productos de Parranda con el catálogo de Ventra.
 *
 * No coincide ni uno por nombre exacto —se comprobó sobre los 71 productos que hay en
 * pedidos y los 121 de Ventra: CERO—. Parranda antepone la categoría y pega las
 * unidades:
 *
 *     Parranda:  ALIMENTOS ARROZ BLANCO 25KG SACO
 *     Ventra:              ARROZ BLANCO 25 KG SACO
 *
 * Con esto cruzan 56 de 71 (78%). Los 15 restantes NO son un fallo del algoritmo: son
 * productos que no están en Ventra (PARRANDA 0.33L, MALTA GUAJIRA) o con otro formato
 * (10 KG contra 1 KG PACA 30U). Ésos los resuelve una persona en la tabla de vínculos
 * —adivinarlos sería peor: un precio equivocado no falla, sale mal y cuadra.
 */

/** Categorías que Parranda antepone. `HIGIENE-HOGAR` es UNA, no dos palabras. */
const CATEGORIAS = [
  'HIGIENE HOGAR', 'ALIMENTOS', 'BEBIDAS', 'CONSERVAS', 'LACTEOS', 'ACEITES',
  'GALLETAS', 'CARNES', 'DULCES', 'SNACKS', 'REFRESCOS', 'RONES', 'ASEO', 'OTRO',
];

/** Mayúsculas, sin tildes, sin puntuación, y `25KG` -> `25 KG`. */
export function normalizarProducto(nombre: string): string {
  return (nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // Litros a mililitros: el pedido dice "0.33L" y Ventra "330 ML". Es el MISMO
    // producto y sin esto no cruzaban ni la cerveza Parranda ni la malta —los dos
    // productos de la casa, que sí tienen precio en Ventra—.
    .replace(/(\d+(?:[.,]\d+)?)\s*L\b/g, (_m, n: string) =>
      `${Math.round(parseFloat(n.replace(',', '.')) * 1000)} ML`)
    // La unidad pegada al número es la otra diferencia: 25KG / 15M.
    .replace(/(\d)\s*(KG|ML|LT|G|M|U)\b/g, '$1 $2')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Las formas en que ese nombre podría estar escrito en Ventra, de la más fiel a la más
 * permisiva. Se prueban EN ORDEN y se para en la primera que exista: así un nombre que
 * coincide tal cual nunca se confunde con otro por haberle quitado una palabra.
 */
export function variantesProducto(nombre: string): string[] {
  const n = normalizarProducto(nombre);
  const out = [n];
  for (const c of CATEGORIAS) {
    if (n.startsWith(c + ' ')) out.push(n.slice(c.length + 1));
  }
  const p = n.split(' ');
  // Quitar la primera palabra cubre las categorías que no están en la lista. Va al
  // final a propósito: es la más agresiva y sólo se usa si no acertó ninguna antes.
  if (p.length > 1) out.push(p.slice(1).join(' '));
  return [...new Set(out.filter(Boolean))];
}

/**
 * Último recurso: el nombre del pedido está CONTENIDO en el de Ventra.
 *
 * "PARRANDA 330 ML" dentro de "CERVEZA PARRANDA 330 ML BLISTER 6U". Ventra añade el
 * tipo delante y el formato detrás, y eso ninguna normalización lo arregla porque no es
 * una forma distinta de escribir: son palabras que en un sitio están y en el otro no.
 *
 * Sólo vale si hay UN candidato. Con dos o más no se elige: "PARRANDA 330 ML" podría
 * caer en el blíster de 6 y en la caja de 24, y acertar a medias es peor que no
 * acertar — un precio equivocado no falla, sale mal y cuadra.
 */
export function porContenido(nombre: string, candidatos: string[]): string | null {
  const t = new Set(normalizarProducto(nombre).split(' ').filter(Boolean));
  if (!t.size) return null;
  const caben = candidatos.filter((k) => {
    const s = new Set(k.split(' '));
    return [...t].every((w) => s.has(w));
  });
  return caben.length === 1 ? caben[0] : null;
}
