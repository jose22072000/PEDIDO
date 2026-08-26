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
    // La unidad pegada al número es la diferencia más común: 25KG / 15M / 0.33L.
    .replace(/(\d)\s*(KG|ML|LT|L|G|M|U)\b/g, '$1 $2')
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
