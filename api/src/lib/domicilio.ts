// El costo de domicilio: lo que le mandamos a la APK para que lo cotice, y lo que
// hacemos con lo que nos devuelve.
//
// El reparto es: nosotros sabemos QUÉ se pide, CUÁNTO pesa y DÓNDE hay que llevarlo;
// ellos saben cuánto cuesta llevarlo. Por eso el pedido sale de aquí con el total de
// la mercancía ya hecho y sin la línea de domicilio, y vuelve sólo con esa línea.
import prisma from '../prismaClient';
import { tasaActual } from './tasaCambio';
import { normalizarProducto, variantesProducto, porContenido } from './nombreProducto';
import { readConfiguredSucursalId } from './sucursalLocal';
import { encolarWebhook } from './queues';

/**
 * PEDIDO ya no le manda pedidos a delivery-apk. Esto está borrado entero.
 *
 * El repartidor teclea el folio en delivery-apk y elige al cliente, que delivery-apk ya
 * tiene sincronizado desde /integration/clients. O sea que delivery-apk no necesita que
 * PEDIDO le avise de nada: cuando llega el pedido, ya lo tiene delante.
 *
 * Aquí vivía el payload de salida, la cola que lo mandaba y el relleno de pendientes.
 * Todo eso resolvía un problema que no existe, y mientras estuviera, PEDIDO seguiría
 * gastando trabajo y arriesgando fallos por avisar de algo a quien ya lo sabe.
 *
 * Queda UN solo webhook en PEDIDO, y es de ENTRADA: delivery-apk manda folio, costo y
 * distancia, y PEDIDO contesta qué hizo con cada uno.
 */

/**
 * Lo que PEDIDO hizo de verdad con una entrega de delivery-apk.
 *
 * No basta con "ok": delivery-apk manda varias cosas a la vez (costo, tasa, distancia,
 * ubicación corregida) y cada una puede guardarse o no por su cuenta. Una tasa en cero
 * se descarta, una coordenada fuera de Cuba se descarta, y una ubicación igual a la que
 * ya había no se toca. Si la respuesta sólo dijera "aplicada", del otro lado se daría
 * por guardado algo que no lo está, y nadie se enteraría hasta cobrar mal.
 */
export type CambiosDomicilio = {
  costo: boolean;
  tasa: boolean;
  distancia: boolean;
  ubicacionCliente: boolean;
};

export type ResultadoCosto = {
  ok: boolean;
  pedidoId?: string;
  folio?: string;
  motivo?: string;
  cambios?: CambiosDomicilio;
};

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
/** Compara coordenadas sin que un decimal de ruido cuente como que el cliente se movió. */
function redondear(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e6;
}

export async function aplicarCostoDomicilio(u: {
  pedidoId?: string | null;
  folio?: string | null;
  vendedorCodigo?: string | null;
  costo: number;
  distanciaKm?: number | null;
  /** Desde dónde se midió la distancia. Ej: "almacen:HAB". */
  distanciaDesde?: string | null;
  /**
   * Dónde está el cliente de verdad, si la APK lo averiguó.
   *
   * Hay clientes que llegan de Parranda SIN coordenadas —123 ahora mismo— y a ésos
   * no se les puede cotizar el domicilio. Quien va a llevar el pedido sí sabe dónde
   * es, así que se le deja apuntarlo.
   */
  latitud?: number | null;
  longitud?: number | null;
}): Promise<ResultadoCosto> {
  const local = readConfiguredSucursalId();
  const costo = Number(u.costo);
  if (!Number.isFinite(costo) || costo < 0) {
    return { ok: false, motivo: 'costo no es un número válido' };
  }

  /**
   * La tasa CUP/USD del momento, de NUESTRA fuente.
   *
   * delivery-apk no la manda: manda el costo en USD y ya. La tasa la trae PEDIDO por su
   * cuenta cada 12 h, y se estampa aquí junto al costo para que el importe en CUP se
   * pueda reproducir exacto —el mismo que vio quien cobró— aunque para entonces la tasa
   * sea otra. Guardar un segundo importe en pesos, en vez de la tasa, dejaría dos
   * verdades que se separan en cuanto cambie el cambio.
   *
   * Si no hay tasa todavía se guarda en nulo y no pasa nada: el costo en USD, que es lo
   * que se cobra, entra igual. Poner un cero sería peor —un CUP calculado a cero no
   * parece un dato que falta, parece un domicilio gratis.
   */
  const tasa = await tasaActual();
  const tasaValida = tasa && tasa.cupPorUsd > 0 ? tasa.cupPorUsd : null;

  const alcance = local ? { sucursalId: local } : {};

  /**
   * La distancia se guarda en el CLIENTE, no sólo en el pedido.
   *
   * Del almacén a un cliente hay la distancia que hay: no cambia de un pedido al
   * siguiente. Guardándola en el cliente, calcularla una vez sirve para todos sus
   * pedidos — y el día que haya que cotizar sin poder preguntarle a la APK, el dato
   * ya está.
   *
   * Se apunta también DESDE DÓNDE se midió. Sin eso es un número sin contexto: siete
   * de los diez almacenes tienen hoy la ubicación puesta en el centro de la ciudad, y
   * el día que se corrijan, las distancias medidas desde el punto viejo quedan mal.
   * Con esta marca se sabe cuáles hay que rehacer; sin ella, o se rehacen todas o no
   * se fía uno de ninguna.
   */
  /**
   * La ubicación y la dirección del cliente, tal como las trae la APK de domicilio.
   *
   * La APK SÍ pisa lo que ya había, a propósito. Quien va a llevar el pedido es el que
   * está parado en la puerta: si dice que el cliente no está donde dice el consolidado
   * de Parranda, el equivocado es el consolidado. Negarse a corregirlo obliga a que
   * alguien vuelva a fallar el domicilio para enterarse.
   *
   * Lo que no se hace es perder lo anterior. Cada cambio deja apuntado el valor que
   * había en ClienteGeoCambio, porque una corrección se equivoca igual de fácil que el
   * dato original —y sin el valor viejo no hay forma de volver atrás ni de ver que un
   * cliente "se mudó" tres veces en una semana, que es como se nota que algo va mal.
   */
  const cambios: CambiosDomicilio = {
    costo: false, tasa: false, distancia: false, ubicacionCliente: false,
  };

  const guardarUbicacion = async (pedidoId: string) => {
    const lat = u.latitud == null ? null : Number(u.latitud);
    const lng = u.longitud == null ? null : Number(u.longitud);
    if (lat == null || lng == null) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Cuba entera cae aquí. Un dígito de más pone al cliente en otro continente y el
    // domicilio se cobraría por miles de kilómetros.
    if (lat < 19 || lat > 24 || lng < -85 || lng > -73) return;

    const pedido = await prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { cliente: { select: { id: true, latitud: true, longitud: true } } },
    });
    const c = pedido?.cliente;
    if (!c) return;

    // Sólo se escribe si el cliente se movió de verdad. delivery-apk manda las
    // coordenadas en cada entrega; sin esta comprobación, el registro de cambios se
    // llenaría de líneas donde no cambió nada y dejaría de servir para ver los cambios
    // que sí importan.
    if (redondear(c.latitud) === redondear(lat) && redondear(c.longitud) === redondear(lng)) return;

    cambios.ubicacionCliente = true;
    await prisma.$transaction([
      prisma.clienteGeoCambio.create({
        data: {
          clienteId: c.id,
          latitudAnterior: c.latitud,
          longitudAnterior: c.longitud,
          latitudNueva: lat,
          longitudNueva: lng,
          fuente: 'apk',
        },
      }),
      prisma.cliente.update({
        where: { id: c.id },
        data: {
          latitud: lat,
          longitud: lng,
          geolocalizacion: `${lat},${lng}`,
          geoFuente: 'apk',
          geoAt: new Date(),
          // La distancia guardada se midió desde donde el cliente ESTABA. Al moverse ya
          // no vale: se borra para que se vuelva a calcular, en vez de cobrar por una
          // distancia a un sitio donde el cliente no está.
          distanciaKm: null,
          distanciaDesde: null,
          distanciaAt: null,
        },
      }),
    ]);
  };

  const guardarDistancia = async (pedidoId: string) => {
    if (u.distanciaKm == null) return;
    const km = Number(u.distanciaKm);
    if (!Number.isFinite(km) || km < 0) return;
    const pedido = await prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { clienteId: true },
    });
    if (!pedido?.clienteId) return;
    await prisma.cliente.update({
      where: { id: pedido.clienteId },
      data: {
        distanciaKm: km,
        distanciaDesde: u.distanciaDesde ? String(u.distanciaDesde).slice(0, 120) : null,
        distanciaAt: new Date(),
      },
    });
    cambios.distancia = true;
  };

  if (u.pedidoId) {
    const r = await prisma.pedido.updateMany({
      where: { id: String(u.pedidoId), ...alcance },
      data: { costoDomicilio: costo, tasaDomicilio: tasaValida },
    });
    if (r.count > 0) {
      await guardarUbicacion(String(u.pedidoId));
      await guardarDistancia(String(u.pedidoId));
    }
    if (r.count > 0) {
      cambios.costo = true;
      cambios.tasa = tasaValida != null;
    }
    return r.count > 0
      ? { ok: true, pedidoId: String(u.pedidoId), cambios }
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
    await prisma.pedido.update({
      where: { id: candidatos[0].id },
      data: { costoDomicilio: costo, tasaDomicilio: tasaValida },
    });
    await guardarUbicacion(candidatos[0].id);
    await guardarDistancia(candidatos[0].id);
    cambios.costo = true;
    cambios.tasa = tasaValida != null;

    return { ok: true, pedidoId: candidatos[0].id, folio: String(u.folio), cambios };
  }

  return { ok: false, motivo: 'falta pedidoId o folio' };
}
