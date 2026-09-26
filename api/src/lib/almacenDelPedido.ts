/**
 * De qué almacén sale un pedido, sacado de las líneas de su factura.
 *
 * Vive SOLO en este fichero y sin un solo `import` a propósito. Es una función pura
 * sobre un texto, y decide DESDE DÓNDE mide el reparto —de ese kilometraje sale el costo
 * del domicilio—, así que tiene que poder probarse sin levantar una base. Metida en
 * `pedidoParaIntegracion` arrastraba Prisma por la cadena del catálogo, y es la segunda
 * vez que pasa lo mismo en este proyecto.
 */
/**
 * DE QUÉ ALMACÉN SALE EL PEDIDO.
 *
 * Se deriva de las líneas de la factura y no se guarda en una columna aparte a
 * propósito: con dos sitios donde vive el mismo dato, el día que uno se reescriba y el
 * otro no, nadie sabrá cuál creer. La factura es la fuente y esto es su resumen.
 *
 * El reparto mide la distancia DESDE EL ALMACÉN, y de ese kilometraje sale el costo del
 * domicilio. Hasta hoy medía todo desde el principal de la sucursal, y en Santiago dos
 * de cada tres pedidos salen de AURORA y no de PV-STGO: la mayoría de los domicilios de
 * esa sucursal se han venido cobrando por una distancia que no era.
 *
 * `mezclado` cuando los renglones salen de más de uno. Entonces `codigo` y `nombre` son
 * los del que pone MÁS renglones —para que haya de dónde medir sin inventarse una
 * regla— y la bandera avisa de que ahí hay dos recogidas de verdad.
 *
 * `null` si el pedido no tiene factura todavía: sin ella no se sabe de dónde sale, y
 * decir un almacén por decir alguno es justo el número creíble y equivocado que esto
 * viene a quitar.
 */
export function almacenDelPedido(lineasFactura: string | null | undefined): {
  codigo: string;
  nombre: string;
  mezclado: boolean;
} | null {
  if (!lineasFactura) return null;

  try {
    const lineas = JSON.parse(lineasFactura) as Array<{ almacenCodigo?: string | null; almacenNombre?: string | null }>;

    if (!Array.isArray(lineas)) return null;

    const cuenta = new Map<string, { nombre: string; n: number }>();

    for (const l of lineas) {
      if (!l?.almacenCodigo) continue;
      const clave = String(l.almacenCodigo);
      const previo = cuenta.get(clave);

      cuenta.set(clave, { nombre: previo?.nombre || String(l.almacenNombre || ''), n: (previo?.n ?? 0) + 1 });
    }

    if (cuenta.size === 0) return null;

    const [codigo, v] = [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n)[0];

    return { codigo, nombre: v.nombre, mezclado: cuenta.size > 1 };
  } catch {
    // Un JSON ilegible no puede dejar el pedido sin salir: se manda sin almacén.
    return null;
  }
}
