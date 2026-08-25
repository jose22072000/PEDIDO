// El costo de domicilio: lo que le mandamos a la APK para que lo cotice, y lo que
// hacemos con lo que nos devuelve.
//
// El reparto es: nosotros sabemos QUÉ se pide, CUÁNTO pesa y DÓNDE hay que llevarlo;
// ellos saben cuánto cuesta llevarlo. Por eso el pedido sale de aquí con el total de
// la mercancía ya hecho y sin la línea de domicilio, y vuelve sólo con esa línea.
import prisma from '../prismaClient';
import { readConfiguredSucursalId } from './sucursalLocal';
import { encolarWebhook } from './queues';

/** Todo lo que la APK necesita para cotizar un domicilio y para saber a quién apuntarlo. */
export async function payloadDomicilio(pedidoId: string) {
  const p = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    include: {
      items: true,
      sucursal: { select: { id: true, codigo: true, nombre: true } },
      cliente: {
        select: {
          id: true, codigo: true, nombre: true, direccion: true, municipio: true,
          zona: true, latitud: true, longitud: true,
        },
      },
      vendedor: {
        select: {
          id: true, codigo: true, nombre: true,
          sucursal: { select: { codigo: true, nombre: true } },
          gestor: {
            select: {
              id: true, username: true,
              sucursal: { select: { codigo: true, nombre: true } },
            },
          },
        },
      },
    },
  });
  if (!p) return null;

  // Precio y peso salen del catálogo de SU sucursal: el mismo producto no pesa distinto
  // en Camagüey, pero sí vale distinto, y el stock es de allí.
  const nombres = [...new Set(p.items.map((i) => i.producto).filter(Boolean))];
  const catalogo = p.sucursalId && nombres.length
    ? await prisma.productoSucursal.findMany({
        where: { sucursalId: p.sucursalId, nombre: { in: nombres } },
        select: { sku: true, nombre: true, precio: true, pesoKg: true },
      })
    : [];
  const porNombre = new Map(catalogo.map((c) => [c.nombre.trim().toUpperCase(), c]));

  let totalMercancia = 0;
  let sinPrecio = 0;
  let pesoTotalKg = 0;
  let sinPeso = 0;

  const items = p.items.map((i) => {
    const c = porNombre.get((i.producto || '').trim().toUpperCase());
    // El precio y el peso de Ventra son por UNIDAD DE VENTA (el pack o la caja), no por
    // botella. Multiplicarlos por las unidades sueltas da cifras absurdas.
    const cantidad = i.packs && i.packs > 0 ? i.packs : i.unidades;
    const importe = c?.precio != null ? Number((c.precio * cantidad).toFixed(2)) : null;
    const peso = c?.pesoKg != null ? Number((c.pesoKg * cantidad).toFixed(3)) : null;

    if (importe == null) sinPrecio++; else totalMercancia += importe;
    if (peso == null) sinPeso++; else pesoTotalKg += peso;

    return {
      sku: c?.sku ?? null,
      producto: i.producto,
      unidades: i.unidades,
      packs: i.packs,
      pesoUnidadKg: c?.pesoKg ?? null,
      pesoKg: peso,
      precioUnidad: c?.precio ?? null,
      importe,
    };
  });

  return {
    evento: 'domicilio.solicitado',
    pedidoId: p.id,
    folio: p.folio,
    estado: p.estado,
    requiereDomicilio: p.requiere_domicilio ?? false,
    fecha: p.fecha ? p.fecha.toISOString() : null,
    fechaComprometida: p.fecha_comprometida ? p.fecha_comprometida.toISOString() : null,
    updatedAt: p.updatedAt ? p.updatedAt.toISOString() : null,

    sucursalId: p.sucursal?.id ?? null,
    sucursalCodigo: p.sucursal?.codigo ?? null,
    sucursalNombre: p.sucursal?.nombre ?? null,

    // A quién se le atribuye la entrega: sucursal -> gestor -> vendedor.
    vendedor: p.vendedor
      ? {
          id: p.vendedor.id,
          codigo: p.vendedor.codigo,
          nombre: p.vendedor.nombre,
          sucursalCodigo: p.vendedor.sucursal?.codigo ?? null,
          gestor: p.vendedor.gestor
            ? {
                id: p.vendedor.gestor.id,
                usuario: p.vendedor.gestor.username,
                sucursalCodigo: p.vendedor.gestor.sucursal?.codigo ?? null,
              }
            : null,
        }
      : null,

    // Dónde hay que llevarlo. La dirección del pedido manda sobre la del cliente: es la
    // que se escribió para ESTA entrega.
    cliente: p.cliente
      ? {
          codigo: p.cliente.codigo,
          nombre: p.cliente.nombre,
          direccion: p.direccion || p.cliente.direccion,
          municipio: p.cliente.municipio,
          zona: p.cliente.zona,
          telefono: p.telefono,
          latitud: p.cliente.latitud,
          longitud: p.cliente.longitud,
        }
      : null,
    encargado: p.encargado,

    items,
    pesoTotalKg: Number(pesoTotalKg.toFixed(3)),
    lineasSinPeso: sinPeso,
    // El total de la MERCANCÍA, sin domicilio: eso es justo lo que ellos añaden.
    totalMercancia: sinPrecio === p.items.length ? null : Number(totalMercancia.toFixed(2)),
    lineasSinPrecio: sinPrecio,
    // Lo que ya tuviera puesto, para que reenviar un aviso no se lea como "sin cotizar".
    costoDomicilio: p.costoDomicilio,
  };
}

export type ResultadoCosto = { ok: boolean; pedidoId?: string; folio?: string; motivo?: string };

/**
 * Escribe el costo que nos devuelve la APK.
 *
 * Idempotente: mandar dos veces lo mismo deja lo mismo. Es lo que permite reintentar
 * sin pensarlo cuando no se sabe si la primera llegó.
 *
 * Se puede identificar el pedido por `pedidoId` o por `folio`. Por folio hace falta el
 * vendedor o la sucursal, porque el folio NO es único: dos vendedores pueden repetirlo
 * (la clave real es sucursal+folio+vendedor). Sin eso, se rechaza en vez de escribir en
 * el pedido equivocado.
 */
export async function aplicarCostoDomicilio(u: {
  pedidoId?: string | null;
  folio?: string | null;
  vendedorCodigo?: string | null;
  costo: number;
  distanciaKm?: number | null;
}): Promise<ResultadoCosto> {
  const local = readConfiguredSucursalId();
  const costo = Number(u.costo);
  if (!Number.isFinite(costo) || costo < 0) {
    return { ok: false, motivo: 'costo no es un número válido' };
  }

  const alcance = local ? { sucursalId: local } : {};

  if (u.pedidoId) {
    const r = await prisma.pedido.updateMany({
      where: { id: String(u.pedidoId), ...alcance },
      data: { costoDomicilio: costo },
    });
    return r.count > 0
      ? { ok: true, pedidoId: String(u.pedidoId) }
      : { ok: false, pedidoId: String(u.pedidoId), motivo: 'no existe o es de otra sucursal' };
  }

  if (u.folio) {
    const candidatos = await prisma.pedido.findMany({
      where: {
        folio: String(u.folio),
        ...alcance,
        ...(u.vendedorCodigo ? { vendedor: { codigo: String(u.vendedorCodigo) } } : {}),
      },
      select: { id: true },
      take: 2,
    });
    if (candidatos.length === 0) return { ok: false, folio: String(u.folio), motivo: 'folio no encontrado' };
    if (candidatos.length > 1) {
      return {
        ok: false,
        folio: String(u.folio),
        motivo: 'folio repetido en esta sucursal: manda pedidoId o vendedorCodigo',
      };
    }
    await prisma.pedido.update({ where: { id: candidatos[0].id }, data: { costoDomicilio: costo } });
    return { ok: true, pedidoId: candidatos[0].id, folio: String(u.folio) };
  }

  return { ok: false, motivo: 'falta pedidoId o folio' };
}

export const EVENTO_DOMICILIO = 'domicilio.solicitado';

/** Un pedido concreto: avisa de que hay que cotizarlo. Best-effort, nunca lanza. */
export function pedirCotizacion(pedidoId: string): void {
  void encolarWebhook(EVENTO_DOMICILIO, pedidoId);
}

/**
 * Encola TODOS los que están esperando cotización.
 *
 * Declarativo a propósito —"los que requieren domicilio, no tienen costo y sabemos
 * dónde vive el cliente"— en vez de intentar enganchar cada camino por el que puede
 * nacer un pedido. Se cura solo: si la APK estuvo caída un día, la siguiente
 * importación (o el botón de Configuración) vuelve a encolar lo que quedó sin cotizar,
 * y el jobId evita que se dupliquen los que ya estaban esperando.
 */
export async function encolarPendientesDeDomicilio(opts: {
  sucursalId?: string | null;
  limite?: number;
} = {}): Promise<number> {
  const pendientes = await prisma.pedido.findMany({
    where: {
      requiere_domicilio: true,
      costoDomicilio: null,
      archivedAt: null,
      ...(opts.sucursalId ? { sucursalId: opts.sucursalId } : {}),
      // Sin coordenadas no hay nada que cotizar: mandarlo sería darle trabajo a la APK
      // para que conteste que no puede. Eso se arregla geolocalizando al cliente.
      cliente: { latitud: { not: null }, longitud: { not: null } },
    },
    select: { id: true },
    orderBy: { fecha: 'desc' },
    take: Math.min(opts.limite ?? 1000, 5000),
  });

  // Relleno: va por detrás de lo que esté pasando ahora mismo.
  for (const p of pendientes) await encolarWebhook(EVENTO_DOMICILIO, p.id, { relleno: true });
  return pendientes.length;
}
