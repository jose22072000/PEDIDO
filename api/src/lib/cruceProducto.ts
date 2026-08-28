/**
 * Cruzar una línea de pedido con la fila de Ventra que le toca. SIN base de datos.
 *
 * Esto vivía dentro de `catalogoSucursal`, que abre Prisma nada más importarlo: para
 * probar el cruce —el desempate del producto duplicado, el orden de las variantes, que el
 * vínculo a mano mande— hacía falta una base en pie. Y es justo la parte que hay que
 * poder probar sola: cuando se rompe no falla nada, sale un número y cuadra.
 */

import { normalizarProducto, variantesProducto, porContenido } from './nombreProducto';

export interface FilaCatalogo {
  nombre: string;
  precio: number | null;
  pesoKg: number | null;
  stock: number | null;
}

export interface CatalogoSucursal {
  /** La fila de Ventra que corresponde a ese nombre de Parranda, o `undefined`. */
  buscar(producto: string | null | undefined): FilaCatalogo | undefined;
}

/**
 * Las dos filas del mismo producto, en una.
 *
 * Ventra manda el mismo producto duplicado —19 casos por sucursal—, una fila con precio
 * y otra sin él, y lo mismo con el peso. Quedarse con "la que tiene precio" perdía el
 * peso, y quedarse con "la que tiene peso" perdía el precio: el dato existía en la base
 * y no llegaba a ninguna parte. Se juntan, y cada campo lo pone la primera fila que lo
 * traiga.
 */
function juntar(previo: FilaCatalogo | undefined, fila: FilaCatalogo): FilaCatalogo {
  if (!previo) return fila;
  return {
    nombre: previo.nombre,
    precio: previo.precio ?? fila.precio,
    pesoKg: previo.pesoKg ?? fila.pesoKg,
    stock: previo.stock ?? fila.stock,
  };
}

/**
 * El índice, aparte de la base, para poder probarlo.
 *
 * Todo lo que puede salir mal aquí —el desempate del producto duplicado, el orden de las
 * variantes, que el vínculo a mano mande— no necesita una base de datos para fallar.
 */
export function indexarCatalogo(filas: FilaCatalogo[], vinculos: Map<string, string>): CatalogoSucursal {
  const porNombre = new Map<string, FilaCatalogo>();
  for (const f of filas) {
    const k = normalizarProducto(f.nombre);
    porNombre.set(k, juntar(porNombre.get(k), f));
  }
  const claves = [...porNombre.keys()];

  return {
    buscar(producto) {
      if (!producto) return undefined;
      // Se prueban las formas posibles de ese nombre, de la más fiel a la más
      // permisiva, y se para en la primera que exista. El vínculo a mano va PRIMERO:
      // si una persona dijo cuál es, es ése.
      const variantes = variantesProducto(producto);
      const aMano = variantes.map((k) => vinculos.get(k)).find(Boolean);
      if (aMano && porNombre.has(aMano)) return porNombre.get(aMano);

      const directo = variantes.map((k) => porNombre.get(k)).find(Boolean);
      if (directo) return directo;

      // Último recurso: que el nombre del pedido esté contenido en uno de Ventra, y en
      // UNO SOLO. Así entra "PARRANDA 0.33L" en "CERVEZA PARRANDA 330 ML BLISTER 6U".
      const k = porContenido(producto, claves);
      return k ? porNombre.get(k) : undefined;
    },
  };
}

/**
 * Cuántas unidades de venta lleva una línea.
 *
 * El precio y el peso de Ventra son por UNIDAD DE VENTA (el pack/caja). `packs` es
 * cuántas van; cuando no viene, la línea es de unidades sueltas y se usan ésas.
 */
export function unidadesDeVenta(packs: number | null | undefined, unidades: number): number {
  return packs && packs > 0 ? packs : unidades;
}
