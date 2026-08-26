// El costo de domicilio: lo que le mandamos a la APK para que lo cotice, y lo que
// hacemos con lo que nos devuelve.
//
// El reparto es: nosotros sabemos QUÉ se pide, CUÁNTO pesa y DÓNDE hay que llevarlo;
// ellos saben cuánto cuesta llevarlo. Por eso el pedido sale de aquí con el total de
// la mercancía ya hecho y sin la línea de domicilio, y vuelve sólo con esa línea.
import prisma from '../prismaClient';
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
  direccionCliente: boolean;
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
  /**
   * La dirección tal como la encontró quien fue a llevar el pedido.
   *
   * Va junto con las coordenadas y no por separado: si el repartidor corrige el punto
   * del mapa pero la dirección escrita sigue diciendo otra cosa, el siguiente que lea
   * la ficha no sabe a cuál de las dos hacerle caso.
   */
  direccion?: string | null;
  /**
   * La tasa CUP/USD con la que la APK calculó ese costo.
   *
   * El costo viaja en USD. La tasa la pone Amado, que es quien la tiene de primera
   * mano, y se guarda con el pedido para que el importe en CUP se pueda reproducir
   * exacto el día que haga falta —aunque para entonces la tasa sea otra.
   */
  tasa?: number | null;
}): Promise<ResultadoCosto> {
  const local = readConfiguredSucursalId();
  const costo = Number(u.costo);
  if (!Number.isFinite(costo) || costo < 0) {
    return { ok: false, motivo: 'costo no es un número válido' };
  }

  /**
   * La tasa sólo se guarda si es creíble.
   *
   * Un cero o un nulo colado aquí no daría error: dejaría el pedido con una tasa que
   * al reproducir el importe en CUP da cero, y eso se descubre cobrando.
   */
  const t = u.tasa == null ? null : Number(u.tasa);
  const tasaValida = t != null && Number.isFinite(t) && t > 0 ? t : null;

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
    costo: false, tasa: false, distancia: false,
    ubicacionCliente: false, direccionCliente: false,
  };

  const guardarUbicacion = async (pedidoId: string) => {
    const lat = u.latitud == null ? null : Number(u.latitud);
    const lng = u.longitud == null ? null : Number(u.longitud);
    const dir = (u.direccion || '').trim() || null;

    const hayPunto = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
    if (!hayPunto && !dir) return;

    // Cuba entera cae aquí. Un dígito de más pone al cliente en otro continente y el
    // domicilio se cobraría por miles de kilómetros.
    const puntoValido =
      hayPunto && lat! >= 19 && lat! <= 24 && lng! >= -85 && lng! <= -73;
    if (hayPunto && !puntoValido) return;

    const pedido = await prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        cliente: {
          select: { id: true, latitud: true, longitud: true, direccion: true },
        },
      },
    });
    const c = pedido?.cliente;
    if (!c) return;

    // Sólo se escribe si algo cambia de verdad. La APK manda estos datos en cada
    // cotización; sin esta comprobación, el registro de cambios se llenaría de líneas
    // donde no cambió nada y dejaría de servir para ver los cambios de verdad.
    const movio =
      puntoValido && (redondear(c.latitud) !== redondear(lat) || redondear(c.longitud) !== redondear(lng));
    const cambioDir = dir != null && dir !== (c.direccion || '').trim();
    if (!movio && !cambioDir) return;

    cambios.ubicacionCliente = movio;
    cambios.direccionCliente = cambioDir;
    await prisma.$transaction([
      prisma.clienteGeoCambio.create({
        data: {
          clienteId: c.id,
          latitudAnterior: c.latitud,
          longitudAnterior: c.longitud,
          direccionAnterior: c.direccion,
          latitudNueva: movio ? lat : c.latitud,
          longitudNueva: movio ? lng : c.longitud,
          direccionNueva: cambioDir ? dir : c.direccion,
          fuente: 'apk',
        },
      }),
      prisma.cliente.update({
        where: { id: c.id },
        data: {
          ...(movio
            ? { latitud: lat, longitud: lng, geolocalizacion: `${lat},${lng}` }
            : {}),
          ...(cambioDir ? { direccion: dir } : {}),
          geoFuente: 'apk',
          geoAt: new Date(),
          // La distancia guardada se midió desde donde el cliente ESTABA. Si se movió,
          // ya no vale: se borra para que se vuelva a calcular en vez de cobrar por una
          // distancia a un sitio donde el cliente no está.
          ...(movio ? { distanciaKm: null, distanciaDesde: null, distanciaAt: null } : {}),
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
