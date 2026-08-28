/**
 * El catálogo de Ventra de una sucursal, indexado y resuelto UNA sola vez.
 *
 * Esto estaba escrito dos veces: en `conPrecios` (el panel) y en `/integration/orders`
 * (lo que se le manda a delivery). Dos implementaciones del mismo cruce, y no daban lo
 * mismo:
 *
 *   - El panel usaba los VÍNCULOS A MANO (`ProductoVinculo`); la integración no. Así que
 *     un producto atado por una persona salía con precio en pantalla y sin peso en el
 *     payload — y delivery cobraba el domicilio de un pedido que "no pesa nada".
 *   - Con el producto duplicado en Ventra, el panel se quedaba con la fila que TIENE
 *     PRECIO y la integración con la que TIENE PESO. Podían ser filas distintas.
 *
 * Aquí se resuelve una vez, y el precio y el peso salen de la MISMA fila.
 */

import prisma from '../prismaClient';
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

function indexar(filas: FilaCatalogo[], vinculos: Map<string, string>): CatalogoSucursal {
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

/** Los vínculos que alguien ató a mano, normalizados a las dos puntas. */
async function leerVinculos(): Promise<Map<string, string>> {
  const filas = await prisma.productoVinculo.findMany({
    select: { nombrePedido: true, nombreVentra: true },
  });
  return new Map(
    filas.map((v) => [normalizarProducto(v.nombrePedido), normalizarProducto(v.nombreVentra)] as const),
  );
}

/**
 * El catálogo ENTERO de esa sucursal, no filtrado por nombre.
 *
 * Filtrarlo con `nombre: { in: [...] }` era pedirle a la base los productos que se
 * llamaran EXACTAMENTE como en el pedido —"ALIMENTOS ARROZ BLANCO 25KG SACO"— y ese
 * nombre no existe en Ventra: siempre volvía vacío. Son ~127 filas por sucursal.
 */
export async function catalogoDeSucursal(sucursalId: string): Promise<CatalogoSucursal> {
  const [filas, vinculos] = await Promise.all([
    prisma.productoSucursal.findMany({
      where: { sucursalId },
      select: { nombre: true, precio: true, pesoKg: true, stock: true },
    }),
    leerVinculos(),
  ]);
  return indexar(filas, vinculos);
}

/**
 * Los catálogos de VARIAS sucursales de una vez.
 *
 * Una consulta por sucursal presente y no una por pedido, y los vínculos —que son
 * globales— se leen UNA sola vez para todas.
 */
export async function catalogosDeSucursales(
  sucursalIds: string[],
): Promise<Map<string, CatalogoSucursal>> {
  const ids = [...new Set(sucursalIds.filter(Boolean))];
  const out = new Map<string, CatalogoSucursal>();
  if (!ids.length) return out;

  const vinculos = await leerVinculos();
  for (const sucursalId of ids) {
    const filas = await prisma.productoSucursal.findMany({
      where: { sucursalId },
      select: { nombre: true, precio: true, pesoKg: true, stock: true },
    });
    out.set(sucursalId, indexar(filas, vinculos));
  }
  return out;
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
