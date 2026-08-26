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
        // El catálogo ENTERO, no filtrado por nombre: los nombres de Parranda y los
        // de Ventra NO coinciden ("ALIMENTOS ARROZ BLANCO 25KG SACO" contra "ARROZ
        // BLANCO 25 KG SACO"), así que filtrar por nombre exacto devolvía CERO filas.
        //
        // Aquí eso era peor que en la lista de pedidos: sin catálogo, `pesoTotalKg`
        // salía 0, y la APK calcula el costo como tarifa × distancia × peso. Le
        // habríamos mandado peso cero y le habría salido CADA DOMICILIO A CERO, sin
        // que nada fallara por ninguna de las dos partes.
        where: { sucursalId: p.sucursalId },
        select: { sku: true, nombre: true, precio: true, pesoKg: true },
      })
    : [];
  // Mismo cruce que en la lista de pedidos: normalizado, y gana el que tiene precio
  // (Ventra manda el producto duplicado, uno con precio y otro sin).
  const porNombre = new Map<string, (typeof catalogo)[number]>();
  for (const c of catalogo) {
    const k = normalizarProducto(c.nombre);
    const previo = porNombre.get(k);
    if (!previo || (previo.precio == null && c.precio != null)) porNombre.set(k, c);
  }

  let totalMercancia = 0;
  let sinPrecio = 0;
  let pesoTotalKg = 0;
  let sinPeso = 0;

  const items = p.items.map((i) => {
    const c = variantesProducto(i.producto || '').map((v) => porNombre.get(v)).find(Boolean)
      // Último recurso: el nombre del pedido contenido en uno de Ventra, y en uno solo.
      ?? (() => {
        const k = porContenido(i.producto || '', [...porNombre.keys()]);
        return k ? porNombre.get(k) : undefined;
      })();
    // El precio y el peso de Ventra son por UNIDAD DE VENTA (el pack o la caja), no por
    // botella. Multiplicarlos por las unidades sueltas da cifras absurdas.
    const cantidad = i.packs && i.packs > 0 ? i.packs : i.unidades;
    const importe = c?.precio != null ? Number((c.precio * cantidad).toFixed(2)) : null;
    const peso = c?.pesoKg != null ? Number((c.pesoKg * cantidad).toFixed(3)) : null;

    if (importe == null) sinPrecio++; else totalMercancia += importe;
    if (peso == null) sinPeso++; else pesoTotalKg += peso;

    return {
      // El producto YA RESUELTO contra Ventra: su sku y su nombre tal cual están allí.
      //
      // Va así para que quien recibe esto no tenga que emparejar nada. Los nombres de
      // Parranda y los de Ventra no coinciden —"ALIMENTOS ARROZ BLANCO 25KG SACO"
      // contra "ARROZ BLANCO 25 KG SACO"— y el cruce ya lo hicimos aquí: repetirlo del
      // otro lado sería resolver dos veces el mismo problema, y con dos criterios
      // distintos que un día dejarían de coincidir.
      //
      // `producto` se mantiene con el nombre de Parranda porque es el que aparece en
      // el pedido y el que la gente reconoce al mirarlo.
      sku: c?.sku ?? null,
      productoVentra: c?.nombre ?? null,
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
          /**
           * Le decimos a la APK qué le falta a este cliente, en vez de que lo deduzca.
           *
           * "sinUbicacion" no es lo mismo que un fallo: es un encargo. Significa que
           * hace falta que alguien ponga dónde vive, y que si nos devuelven lat/lng se
           * guardan. Sin esta marca, la APK recibe un cliente con las coordenadas en
           * nulo y no puede distinguir "no la tenemos" de "se perdió por el camino".
           */
          sinUbicacion: p.cliente.latitud == null || p.cliente.longitud == null,
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
    // Los importes van en USD. Si la APK manda la tasa con la que cotizó, se guarda con
    // el pedido y el CUP se reproduce exacto el día que haga falta.
    moneda: 'USD',
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
    await prisma.pedido.update({
      where: { id: candidatos[0].id },
      data: { costoDomicilio: costo, tasaDomicilio: tasaValida },
    });
    await guardarUbicacion(candidatos[0].id);
    await guardarDistancia(candidatos[0].id);
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
      /**
       * Los clientes SIN coordenadas también van. Antes se filtraban, y era un error:
       * la APK es justamente la que pone la ubicación de quien no la tiene, así que
       * dejarlos fuera los condenaba a no tenerla nunca. Granma tiene hoy 362 clientes
       * sin geolocalizar y ninguno se podía cotizar; sacándolos de aquí, se quedaban
       * así para siempre.
       *
       * Lo que sí hace falta es una dirección: sin coordenadas y sin dirección no hay
       * nada por donde empezar a buscar, y eso se arregla en Clientes, no en la APK.
       */
      OR: [
        { cliente: { latitud: { not: null }, longitud: { not: null } } },
        { cliente: { direccion: { not: null } } },
        { direccion: { not: null } },
      ],
    },
    select: { id: true },
    orderBy: { fecha: 'desc' },
    take: Math.min(opts.limite ?? 1000, 5000),
  });

  // Relleno: va por detrás de lo que esté pasando ahora mismo.
  for (const p of pendientes) await encolarWebhook(EVENTO_DOMICILIO, p.id, { relleno: true });
  return pendientes.length;
}
