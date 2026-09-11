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
import { claveDeCliente } from '../dto/orderRecord.dto';

/**
 * PEDIDO ya no le manda pedidos a Entrega. Esto está borrado entero.
 *
 * El repartidor teclea el folio en Entrega y elige al cliente, que Entrega ya
 * tiene sincronizado desde /integration/clients. O sea que Entrega no necesita que
 * PEDIDO le avise de nada: cuando llega el pedido, ya lo tiene delante.
 *
 * Aquí vivía el payload de salida, la cola que lo mandaba y el relleno de pendientes.
 * Todo eso resolvía un problema que no existe, y mientras estuviera, PEDIDO seguiría
 * gastando trabajo y arriesgando fallos por avisar de algo a quien ya lo sabe.
 *
 * Queda UN solo webhook en PEDIDO, y es de ENTRADA: Entrega manda folio, costo y
 * distancia, y PEDIDO contesta qué hizo con cada uno.
 */

/**
 * Lo que PEDIDO hizo de verdad con una entrega de Entrega.
 *
 * No basta con "ok": Entrega manda varias cosas a la vez (costo, tasa, distancia,
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

/**
 * ¿Este pedido NO va a domicilio? Devuelve el motivo, o null si se puede cobrar.
 *
 * Un costo de domicilio sobre un pedido que no lleva domicilio es dinero cobrado por un
 * reparto que nadie pidió. Entraban por la APK de Entrega: alguien registra la entrega de
 * un pedido que en PEDIDO está marcado como «sin domicilio» y aquí se escribía sin
 * mirar. El 10/09/2026 había ONCE así —de 966 con costo, un 1%—, y el más reciente con un
 * minuto de diferencia entre crearse el pedido y ponerle el precio.
 *
 * Se rechaza SOLO cuando la bandera está en `false`, o sea cuando alguien dijo
 * explícitamente que ese pedido no va a domicilio. Con `null` se deja pasar: hay 14.647
 * pedidos sin la bandera puesta —«no se sabe»— y bloquearlos sería romper repartos
 * buenos por un dato que nunca se rellenó.
 *
 * Y se devuelve el MOTIVO, no un silencio: la APK recibe el rechazo por entrega, con su
 * folio, y puede corregirlo. Un rechazo mudo se repite cada minuto para siempre.
 */
async function sinDomicilio(pedidoId: string): Promise<string | null> {
  const p = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    select: { requiere_domicilio: true },
  });

  if (p && p.requiere_domicilio === false) {
    return 'ese pedido no va a domicilio (requiere_domicilio = false): no se le pone costo';
  }

  return null;
}

export async function aplicarCostoDomicilio(u: {
  pedidoId?: string | null;
  folio?: string | null;
  /**
   * Quién lo vendió. Los tres valen y se prueban en ese orden.
   *
   * Es el otro desempate, y el bueno cuando dos vendedores repiten folio: las iniciales
   * del vendedor van DENTRO del folio (`PDG26` es `P`+`DG`+`26`) y hay seis prefijos
   * compartidos por dos personas con las mismas iniciales —Dayana González y Diango Gola
   * bajo `PDG26`, Adrián Pupo y Alexander Padrón bajo `PAP25`—. Hoy no llega a chocar
   * ningún folio entero (0 de 27.046), pero el día que choque esto lo separa.
   *
   * No sustituye al cliente: cuando un folio trae 23 clientes, los 23 son del MISMO
   * vendedor —uno usa un folio para toda su jornada—, así que el vendedor los agrupa y
   * sólo el cliente los separa.
   *
   * Los 100 vendedores tienen código y son todos distintos, así que `vendedorCodigo`
   * (`yanisleydis.garcia`) basta; `vendedorId` es el de `/integration/vendedores`.
   */
  vendedorId?: string | null;
  vendedorCodigo?: string | null;
  vendedorNombre?: string | null;
  /**
   * Quién es el cliente de ese folio. Es lo que desambigua el sufijo.
   *
   * El folio lo pone Parranda y NO es único: un mismo folio llega con hasta 23 clientes
   * distintos debajo (`POR26-260904-3389`, Santiago, 04/09/2026). Al importarlos hay que
   * darles `-1`, `-2`… o el segundo pisaría al primero, así que el folio que guardamos
   * deja de ser el que tiene quien lo manda.
   *
   * Ese sufijo es NUESTRO y no hay forma de que lo deduzcan de fuera. Pero con el folio
   * tal como viene de Parranda MÁS el cliente, el pedido queda señalado sin ambigüedad:
   * comprobado sobre los 18.818 pedidos desde agosto, la pareja (folio base, sucursal,
   * código de cliente) no se repite ni una sola vez.
   *
   * El código es lo bueno, pero falta en el 17,9% de los pedidos —Granma y Moa no tienen
   * ninguno, Santiago el 29,8%—, así que el nombre vale de reserva: por nombre chocan 11
   * de 18.818, y esos once se rechazan con su motivo en vez de adivinar.
   */
  /**
   * NUESTRO id de cliente, el que sale en `GET /integration/clients`.
   *
   * Es el mejor de los tres porque no tiene agujeros: el código falta en el 17,9% de los
   * pedidos —Granma y Moa no tienen ninguno— y además hay tres numeraciones distintas
   * dando vueltas (la de Ventra, la del CSV de pedidos y la del consolidado de
   * geolocalización), así que «el código del cliente» no quiere decir lo mismo para
   * todo el mundo. Este id sí: lo damos nosotros y lo tiene ya quien sincroniza clientes.
   */
  clienteId?: string | null;
  clienteCodigo?: string | null;
  clienteNombre?: string | null;
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
   * Entrega no la manda: manda el costo en USD y ya. La tasa la trae PEDIDO por su
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

    // Sólo se escribe si el cliente se movió de verdad. Entrega manda las
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
    const noVa = await sinDomicilio(String(u.pedidoId));

    if (noVa) return { ok: false, pedidoId: String(u.pedidoId), motivo: noVa };

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
    const folio = String(u.folio).trim();

    /**
     * El folio que mandan, MÁS los que salieron de él al importarlo.
     *
     * No se le quita nada a lo que viene: se ensancha. Buscamos el folio tal cual y
     * además `folio-1`, `folio-2`… que es lo único que este sistema le añade encima.
     * Así el folio de Parranda vale como identificador aunque nosotros hayamos tenido
     * que desdoblarlo, y quien lo manda no tiene que saber nada de nuestros sufijos.
     *
     * `startsWith` mete también cosas como `folio-1130` —un folio que de verdad lleva
     * otro número detrás—, así que después se filtra a que lo añadido sean una o dos
     * cifras, que es lo que `asignarSufijos` pone.
     */
    const candidatos = (
      await prisma.pedido.findMany({
        where: {
          OR: [{ folio }, { folio: { startsWith: `${folio}-` } }],
          ...alcance,
        },
        select: {
          id: true, folio: true,
          cliente: { select: { id: true, codigo: true, nombre: true } },
          vendedor: { select: { id: true, codigo: true, nombre: true } },
        },
        take: 40,
      })
    ).filter((p) => p.folio === folio || /^-\d{1,2}$/.test(p.folio.slice(folio.length)));

    if (candidatos.length === 0) return { ok: false, folio, motivo: 'folio no encontrado' };

    /**
     * Con varios candidatos, el cliente decide. Primero por código de Parranda; si no
     * viene o ese cliente no lo tiene puesto, por nombre.
     *
     * Comparar nombres es peor que comparar códigos y por eso va segundo, pero sin esta
     * reserva se quedarían fuera Granma y Moa enteras, que no tienen ni un código.
     */
    let elegidos = candidatos;

    /**
     * El vendedor primero, que es el filtro grueso, y luego el cliente.
     *
     * Va como ESTRECHADOR y no dentro de la consulta a propósito. Cuando iba en el
     * `where`, un `vendedorCodigo` que no casara dejaba la búsqueda en cero y se
     * contestaba «folio no encontrado», que es mentira: el folio estaba, lo que no cuadró
     * fue el vendedor. Así, si no casa con nadie no descarta, y el motivo que sale es el
     * de verdad.
     */
    if (elegidos.length > 1 && (u.vendedorId || u.vendedorCodigo || u.vendedorNombre)) {
      const porVendedor = elegidos.filter((p) => {
        const v = p.vendedor;

        if (!v) return false;
        if (u.vendedorId && v.id === String(u.vendedorId).trim()) return true;
        if (u.vendedorCodigo && (v.codigo ?? '').trim() === String(u.vendedorCodigo).trim()) return true;
        if (u.vendedorNombre && claveDeCliente(v.nombre) === claveDeCliente(u.vendedorNombre)) return true;

        return false;
      });

      if (porVendedor.length > 0) elegidos = porVendedor;
    }

    // Por orden de fiabilidad: nuestro id, el código, y el nombre como último recurso.
    if (elegidos.length > 1 && u.clienteId) {
      const id = String(u.clienteId).trim();
      const porId = elegidos.filter((p) => p.cliente?.id === id);

      if (porId.length > 0) elegidos = porId;
    }

    if (elegidos.length > 1 && u.clienteCodigo) {
      const cod = String(u.clienteCodigo).trim();
      const porCodigo = elegidos.filter((p) => (p.cliente?.codigo ?? '').trim() === cod);

      if (porCodigo.length > 0) elegidos = porCodigo;
    }

    if (elegidos.length > 1 && u.clienteNombre) {
      // La MISMA función que decide el sufijo al importar: si para aquello dos nombres
      // son el mismo cliente, aquí también, y no se abre una segunda definición que se
      // separe de la primera con el tiempo.
      const nom = claveDeCliente(u.clienteNombre);
      const porNombre = elegidos.filter((p) => claveDeCliente(p.cliente?.nombre ?? '') === nom);

      if (porNombre.length > 0) elegidos = porNombre;
    }

    if (elegidos.length > 1) {
      /**
       * Se rechaza diciendo QUÉ falta y con quiénes se confundió. Un «folio repetido» a
       * secas obliga a abrir la base para saber qué mandar; con los nombres delante, la
       * corrección se hace desde el otro lado.
       */
      const quienes = elegidos
        .slice(0, 6)
        .map((p) => `${p.cliente?.nombre ?? 'sin nombre'}${p.cliente?.codigo ? ` (${p.cliente.codigo})` : ''}`)
        .join(', ');

      return {
        ok: false,
        folio,
        motivo:
          `ese folio es de ${elegidos.length} clientes distintos: manda clienteId ` +
          `(el de /integration/clients), clienteCodigo o clienteNombre para señalar cuál ` +
          `—y vendedorCodigo si además lo repiten dos vendedores—. Son: ${quienes}`,
      };
    }

    const noVa = await sinDomicilio(elegidos[0].id);

    // Se devuelve el folio NUESTRO, no el que mandaron: ya sabemos a qué pedido señalaba,
    // y decírselo es lo que deja comprobar del otro lado que la identificación acertó y
    // que el rechazo es por el domicilio, no por haber cogido el pedido equivocado.
    if (noVa) return { ok: false, folio: elegidos[0].folio, pedidoId: elegidos[0].id, motivo: noVa };

    await prisma.pedido.update({
      where: { id: elegidos[0].id },
      data: { costoDomicilio: costo, tasaDomicilio: tasaValida },
    });
    await guardarUbicacion(elegidos[0].id);
    await guardarDistancia(elegidos[0].id);
    cambios.costo = true;
    cambios.tasa = tasaValida != null;

    // Se devuelve el folio NUESTRO, con su sufijo si lo lleva: es el que hay que usar
    // para hablar de ese pedido, y quien lo mandó se entera de cuál le tocó.
    return { ok: true, pedidoId: elegidos[0].id, folio: elegidos[0].folio, cambios };
  }

  return { ok: false, motivo: 'falta pedidoId o folio' };
}
