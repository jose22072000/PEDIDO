import { camposParaCompletar } from '../lib/autocompletado';
import { Router } from 'express';
import prisma from '../prismaClient';
import { avisarAlReparto, DONDE_ES_PARA_EL_REPARTO } from '../lib/avisoAlReparto';
import { aplicarEstadosDeEntrega, comoVengan, TOPE_POR_LLAMADA } from '../lib/estadoEntrega';
import { INCLUDE_COMPLETO, mapearParaIntegracion } from '../lib/pedidoParaIntegracion';
import { catalogosDeSucursales } from '../lib/catalogoSucursal';
import { serviceAuth } from '../middleware/serviceAuth';

// Endpoints de integración servidor-a-servidor con delivery (todos con x-api-key).
// Modelo: delivery JALA los pedidos con geo del cliente, calcula el domicilio y
// ESCRIBE DE VUELTA el costo aquí (Pedido.costoDomicilio).
//
// SEGURIDAD DE SUCURSAL: cada instalación de PEDIDO es local a UNA sucursal
// (config.json.sucursalId). La integración se scopea a esa sucursal para que un
// delivery de una sucursal nunca vea ni escriba pedidos de otra.
import { clasificarParranda } from '../lib/productoParranda';
import { readConfiguredSucursalId } from '../lib/sucursalLocal';
import { aplicarCostoDomicilio } from '../lib/domicilio';
import { emitEvent } from '../lib/events';
import { pedidoParaLista } from './orders';
import { ventasDeSucursal, databases } from '../lib/ventra';
import { folioDeLaNota } from '../lib/emparejarFactura';

const router = Router();
router.use(serviceAuth);


/**
 * GET /integration/orders?onlyPending=1&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&since=<ISO>&limit=500
 *                         &vendedor=andy.almanza&estado=no_completada
 *
 * Lista pedidos para cotizar el domicilio. Con onlyPending=1 solo los que aún no
 * tienen costo y cuyo cliente TIENE geolocalización (calculables).
 *
 * # Por qué hay filtros de fecha
 *
 * Quien consume esto es una tablet, una por repartidor, sincronizando por datos
 * móviles y a veces sin cobertura. Traerse el histórico entero en cada arranque son
 * megas y minutos que la tablet no tiene, y encima el 99% son pedidos de hace meses
 * que ya nadie va a cotizar.
 *
 *   desde / hasta  → por FECHA DEL PEDIDO. "Dame los de hoy" o "los de ayer", que es
 *                    lo que el repartidor necesita tener encima antes de salir.
 *   estado         → en_proceso | completada | expirada | no_completada. Con "en_proceso" se lleva
 *                    justo lo que va a repartir: lo completado ya se entregó y lo
 *                    expirado no lo va a llevar hoy.
 *   conGeo         → sólo los que tienen coordenadas. NO es el comportamiento por
 *                    defecto: antes se exigía siempre, y eso escondía justo los pedidos
 *                    que había que cotizar. Lo pide quien cotiza por distancia.
 *   vendedor       → el código del vendedor (`andy.almanza`) o su id, igual que en
 *                    `/integration/clients`. Una tablet por repartidor, cada uno con su
 *                    cartera: sin esto se llevaba la sucursal entera para usar su parte.
 *   estado         → ver abajo. `no_completada` es lo que pide la APK de domicilio y NO
 *                    es lo mismo que `en_proceso`: éste deja fuera las expiradas, que
 *                    siguen sin completarse y su domicilio hay que cobrarlo igual.
 *   since          → por CUÁNDO ENTRÓ O CAMBIÓ (updatedAt). Es el sincronizado
 *                    incremental: se guarda la hora de la última sync y en la
 *                    siguiente solo llega lo que se movió desde entonces. Suele ser
 *                    nada o cuatro filas.
 *
 * Se pueden combinar. `since` es el que hace que una sync sea instantánea.
 */

router.get('/orders', async (req, res) => {
  const onlyPending = req.query.onlyPending === '1' || req.query.onlyPending === 'true';
  /**
   * Sólo los pedidos que LLEVAN domicilio.
   *
   * `onlyPending=1` no sirve para esto aunque lo parezca: además de `requiere_domicilio`
   * exige `costoDomicilio: null`, y el costo lo pone la APK. O sea que se lleva justo los
   * que todavía no han pasado por el repartidor y deja fuera los que ya sirven.
   *
   * Quien planifica rutas quiere los que hay que llevar a casa de alguien, cotizados o
   * no. Traer también los que se recogen en el almacén es llenarle la pantalla de
   * pedidos que no va a repartir nunca.
   */
  const soloDomicilio = req.query.soloDomicilio === '1' || req.query.soloDomicilio === 'true';
  /**
   * Y de ésos, sólo los que YA tienen el costo puesto.
   *
   * El costo lo pone el repartidor desde Entrega. Un pedido que lleva domicilio pero
   * todavía no ha pasado por él no se puede meter en una ruta: no se sabe lo que cuesta
   * llevarlo. Traerlo igual es dejar en la lista pedidos a medias que el que arma la ruta
   * tiene que descartar a mano uno por uno.
   */
  const conCosto = req.query.conCosto === '1' || req.query.conCosto === 'true';
  /**
   * SÓLO LO QUE PUEDE SUBIR A UN CAMIÓN.
   *
   * Repartible es **tener factura**, cuadre o no: `igual` o `cambiado`. Lo que NO entra es
   * lo que no se ha facturado (`sin_factura`) ni lo que no se ha cotejado (`null`), porque
   * de eso no se sabe qué lleva.
   *
   * Que la factura diga otra cosa que el pedido no lo hace irrepartible: lo que se lleva es
   * lo facturado, y por eso las líneas que van en la respuesta son **las de la factura**
   * cuando existen. Ver `itemsOrigen` más abajo.
   *
   * Se añade porque el espejo de delivery se traía el catálogo entero —54.077 pedidos, de
   * los que 49.590 archivados— y de ésos sólo 1.277 podían repartirse. Quien abría la
   * pantalla veía el 100 % para trabajar con el 2 %, y se perdía.
   *
   * Va como parámetro y no por defecto: este endpoint lo consumen también las tabletas de
   * Entrega, que necesitan los pedidos ANTES de facturarse para cotizar el domicilio.
   * Quien quiera sólo lo repartible lo pide.
   */
  const soloRepartibles = req.query.soloRepartibles === '1' || req.query.soloRepartibles === 'true';
  /**
   * SIEMPRE hay tope, se pida o no.
   *
   * Sin `limit` esto devolvía todo lo que cuadrara con el filtro, y un cliente pidiendo
   * quince días se llevó ~7.000 pedidos con sus líneas en una sola respuesta: PEDIDO
   * tiene que construir ese JSON entero en memoria antes de mandarlo y se quedó sin
   * heap. La API se cayó por una petición perfectamente legítima.
   *
   * El tope va aquí y no en quien llama, porque quien llama puede ser cualquiera —y el
   * que tira el servicio no es el que se entera—.
   */
  const TOPE = 2000;
  const pedido = req.query.limit ? Number(req.query.limit) : TOPE;
  const limit = Number.isFinite(pedido) ? Math.min(Math.max(1, pedido), 5000) : TOPE;
  /**
   * EL CURSOR, que es lo que convierte el tope en una molestia en vez de en una pérdida.
   *
   * El tope de arriba está bien y se queda: protege la memoria del servicio. Lo que
   * estaba mal es que NO HABÍA FORMA DE SEGUIR. Quien pedía un mes se llevaba 2.000
   * pedidos, la respuesta decía `count: 2000` tan tranquila, y los que faltaban no
   * existían para él. Sin error, sin aviso y sin nada que mirar.
   *
   * Ese fallo exacto ya costó **2.284 pedidos perdidos en una sola ventana** en el espejo
   * del reparto, con 200 OK. Es el que más caro sale en esta casa porque no se ve.
   *
   * `/integration/clients`, aquí al lado, lleva cursor desde hace tiempo y hace justo
   * esto. Se copia el mismo patrón: mismo nombre de parámetro, misma forma de respuesta.
   */
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
  /**
   * PAGINAR ES OPT-IN, y tiene que serlo desde la PRIMERA página.
   *
   * Si la página 1 saliera ordenada por fecha y la 2 por id, unos pedidos se repetirían
   * y otros no saldrían nunca: paginar por un campo que no es único es el fallo clásico
   * de esto. Y el cursor sólo aparece a partir de la página 2, así que no sirve para
   * decidir el orden de la primera.
   *
   * Por eso hay un interruptor propio: `paginar=1`. Con él, todo el recorrido va por id
   * ascendente de principio a fin. Sin él, no cambia absolutamente nada para quien ya
   * está llamando a esto —mismo orden, lo más nuevo primero—, que es lo que no se puede
   * romper.
   */
  const paginar = req.query.paginar === '1' || req.query.paginar === 'true' || !!cursor;
  const desde = typeof req.query.desde === 'string' ? req.query.desde : '';
  const hasta = typeof req.query.hasta === 'string' ? req.query.hasta : '';
  const since = typeof req.query.since === 'string' ? req.query.since : '';
  // Buscar UN pedido por su folio, que es como lo nombra todo el mundo: es lo que
  // lleva escrito el papel que tiene el repartidor en la mano.
  const folio = typeof req.query.folio === 'string' ? req.query.folio.trim() : '';
  // Por estado. El repartidor sale a la calle con los EN PROCESO: los completados ya
  // se entregaron y los expirados no los va a llevar hoy.
  const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : '';
  /**
   * De QUIÉN son los pedidos. Mismo parámetro y mismo valor que en `/integration/clients`:
   * el código del vendedor (`andy.almanza`), que es único global, o su id.
   *
   * Lo pide la APK de domicilio, que sincroniza por vendedor: una tablet por repartidor y
   * cada uno con su cartera. Sin esto se llevaba la sucursal entera en cada arranque para
   * quedarse con su parte, por datos móviles.
   */
  const vendedor = typeof req.query.vendedor === 'string' ? req.query.vendedor.trim() : '';
  /** Sólo los pedidos cuyo cliente TIENE coordenadas. Ver la nota larga en `where`. */
  const conGeo = req.query.conGeo === '1' || req.query.conGeo === 'true';
  const askedCodigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';
  /**
   * Archivados: por defecto vienen TODOS.
   *
   * Archivar en PEDIDO es esconder de la lista, no borrar, y son 51.871 de 56.208. Quien
   * quiera sólo los vivos que pida `archivado=0`; quien quiera el catálogo entero —que es
   * lo que necesita delivery para planificar rutas de pedidos ya completados— no pide
   * nada. Excluirlos por defecto habría dejado fuera el 92% sin que nadie lo notara.
   */
  const archivado = typeof req.query.archivado === 'string' ? req.query.archivado.trim() : '';

  // Scope a la sucursal local de esta instalación.
  const localSucursalId = readConfiguredSucursalId();
  let sucursalScope: Record<string, unknown> = {};
  if (localSucursalId) {
    sucursalScope = { sucursalId: localSucursalId };
    // Si delivery pide un código, debe ser el de ESTA sucursal; si no, se rechaza.
    if (askedCodigo) {
      const local = await prisma.sucursal.findUnique({ where: { id: localSucursalId } });
      if (local?.codigo && local.codigo !== askedCodigo) {
        return res.status(403).json({
          error: `Esta instalación es de la sucursal '${local.codigo}', no '${askedCodigo}'. No se entregan pedidos de otra sucursal.`,
        });
      }
    }
  } else if (askedCodigo) {
    // Sin config local: al menos filtra por el código pedido.
    sucursalScope = { sucursal: { codigo: askedCodigo } };
  }

  const where = {
    ...sucursalScope,
    /**
     * La geolocalización YA NO se exige. La pide con `conGeo=1` quien la necesite.
     *
     * Era un filtro fijo —«sin lat/lng no se puede medir la distancia ni rutear»— y la
     * intención era buena, pero el efecto era el contrario: un cliente sin coordenadas
     * desaparecía de este endpoint con CUALQUIER parámetro. La APK de domicilio no podía
     * conseguir su `pedidoId`, así que ese domicilio no se enviaba nunca y, por su regla
     * de «sin match no cuenta intentos», se quedaba pendiente para siempre: sin expirar,
     * sin marcarse Fallida y sin avisar a nadie.
     *
     * Y la premisa era falsa. Confirmado por Amado el 15/09/2026: un domicilio SÍ se
     * puede crear sin coordenadas, porque el vendedor geolocaliza al cliente en el
     * momento con la tablet o con MapsMe — y esa ubicación nos vuelve por el webhook, que
     * es de donde salen las correcciones que guarda `ClienteGeoCambio`. O sea que el
     * filtro escondía justo los pedidos que más falta hacía que salieran.
     *
     * Quien de verdad no sabe qué hacer sin coordenadas —la recotización en lote de
     * delivery, que cotiza por distancia— pide `conGeo=1` y sigue igual que siempre.
     */
    ...(conGeo ? { cliente: { latitud: { not: null }, longitud: { not: null } } } : {}),
    // Pendientes de cotizar = los que REQUIEREN domicilio (requiere_domicilio=true) y aún no
    // tienen costo. Un pedido sin domicilio NO lleva costo: no se encola ni se cotiza.
    ...(onlyPending ? { requiere_domicilio: true, costoDomicilio: null } : {}),
    ...(soloDomicilio && !onlyPending ? { requiere_domicilio: true } : {}),
    ...(soloRepartibles ? { facturaEstado: { in: ['igual', 'cambiado'] } } : {}),
    ...(conCosto && !onlyPending ? { costoDomicilio: { not: null } } : {}),
    ...(archivado === '1' || archivado === 'true' ? { archivedAt: { not: null } } : {}),
    ...(archivado === '0' || archivado === 'false' ? { archivedAt: null } : {}),
    // Por fecha del pedido. El 'hasta' incluye el día entero: quien escribe
    // hasta=2026-08-24 quiere los del 24, no los del 24 a las 00:00.
    ...(desde || hasta
      ? {
          fecha: {
            ...(desde ? { gte: new Date(`${desde}T00:00:00`) } : {}),
            ...(hasta ? { lte: new Date(`${hasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    // Incremental: lo que se movió desde la última sincronización.
    ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    // Por folio: contiene y sin distinguir mayúsculas, porque nadie teclea un folio
    // entero ni respeta las mayúsculas al buscar.
    ...(folio ? { folio: { contains: folio, mode: 'insensitive' as const } } : {}),
    // Por estado.
    //
    // "En proceso" y "expirado" NO son columnas: el único estado guardado es
    // 'completada', y expirado se deduce de que la fecha comprometida ya pasó. Así que
    // aquí se traducen a lo que sí se puede consultar, en vez de pedirle a quien llama
    // que sepa esa interioridad.
    // Por vendedor: los suyos y sólo los suyos.
    ...(vendedor ? { vendedor: { OR: [{ codigo: vendedor }, { id: vendedor }] } } : {}),
    ...(estado === 'completada' ? { estado: 'completada' } : {}),
    /**
     * NO COMPLETADAS, que no es lo mismo que `en_proceso`.
     *
     * `en_proceso` deja fuera las expiradas, y una expirada sigue sin completarse: el
     * pedido existe, no se ha entregado y su domicilio hay que cobrarlo igual. Quien
     * pregunta «dame lo que no está cerrado» —la APK de domicilio— con `en_proceso` no
     * vería esos pedidos, no conseguiría su id, y su entrega se quedaría pendiente para
     * siempre sin que nadie se entere.
     */
    ...(estado === 'no_completada' ? { NOT: { estado: 'completada' } } : {}),
    ...(estado === 'en_proceso'
      ? {
          NOT: { estado: 'completada' },
          OR: [{ fecha_comprometida: null }, { fecha_comprometida: { gte: new Date() } }],
        }
      : {}),
    ...(estado === 'expirada'
      ? { NOT: { estado: 'completada' }, fecha_comprometida: { lt: new Date() } }
      : {}),
  };

  const pedidos = await prisma.pedido.findMany({
    where,
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: INCLUDE_COMPLETO as any,
    /**
     * AL PAGINAR SE ORDENA POR ID, que es único y estable.
     *
     * Con `fecha: 'desc'` y cursor, dos pedidos de la misma fecha pueden salir en
     * cualquier orden entre una llamada y la siguiente: unos se repetirían y otros no
     * saldrían nunca. Es el fallo clásico de paginar por un campo que no es único.
     *
     * Sin `paginar` se conserva el orden de siempre —lo más nuevo primero—, porque eso
     * es lo que espera quien ya está llamando a esto y no pagina.
     */
    orderBy: paginar ? { id: 'asc' } : { fecha: 'desc' },
  });

  /**
   * Los pesos de Ventra, resueltos AQUÍ y no por quien recibe.
   *
   * Antes se mandaba sólo el nombre del producto, así que cada aplicación que necesitara
   * el peso tenía que mantener su propio catálogo contra Ventra. Eso son dos catálogos
   * que se desincronizan sin que nadie lo note, y un domicilio cobrado por un peso que
   * no es el nuestro.
   *
   * El cruce es el MISMO que usa el panel para los precios —vínculos a mano incluidos—:
   * está en `lib/catalogoSucursal`. Tenerlo escrito aquí otra vez fue exactamente el
   * problema que esto venía a resolver, un piso más abajo: el panel ataba un producto a
   * mano y la integración seguía sin encontrarlo.
   *
   * Se cargan los catálogos de las sucursales que aparecen en ESTA página, no los diez.
   */
  const catalogos = await catalogosDeSucursales(
    pedidos.map((p) => p.sucursalId).filter(Boolean) as string[],
  );

  // La misma forma que sale por el webhook del reparto: una sola, en `lib/`.
  const orders = mapearParaIntegracion(pedidos, catalogos);

  /**
   * `nextCursor` y `hayMas`: LO QUE FALTA SE DICE.
   *
   * Si la página vino LLENA, hay que dar por hecho que queda más. `nextCursor` es el id
   * del último, y se vuelve a llamar con `&cursor=<ese id>` hasta que `hayMas` sea false.
   *
   * `hayMas` va además de `nextCursor` porque un `null` se lee mal: quien no lo mire
   * nunca se entera. Un booleano con nombre en la respuesta es la única forma de que un
   * truncamiento deje de ser invisible, que es la regla de la casa —si pides un tope,
   * comprueba si lo alcanzaste—.
   */
  const hayMas = pedidos.length === limit;
  const nextCursor = hayMas ? pedidos[pedidos.length - 1].id : null;

  res.json({ count: orders.length, orders, hayMas, nextCursor });
});

/**
 * GET /integration/orders/resumen?desde=&hasta=   (x-api-key)
 *
 * CUÁNTOS PEDIDOS REPARTIBLES HAY POR DÍA, y cuándo se tocó el último de cada día.
 *
 * # Para qué, que es lo que importa
 *
 * El espejo del reparto se bajó HOY 101.445 pedidos para no encontrar nada. En PEDIDO
 * hay 67.971 en total: se releyó el año entero una vez y media, por la conexión de allá
 * y contra esta base, sólo para comprobar que los dos lados dicen lo mismo.
 *
 * Eso tenía sentido cuando el ciclo era LO ÚNICO que traía cambios. Con los avisos
 * funcionando ya no es una red, es un trabajo continuo que no lleva a nada. Jose, el
 * 26/09/2026: «un barrido para que chequee si están iguales los espejos, sólo eso. No
 * que ande buscando y busque lo que tiene PEDIDO que él no tiene».
 *
 * Con esto, comparar un año son **unas 420 filas** en vez de 100.000 pedidos. Los días
 * que cuadran no se tocan; del que no cuadre se piden los ids (`/orders/ids`) y sólo de
 * los que falten se pide el pedido entero.
 *
 * # Por qué `maxUpdatedAt` y no sólo la cuenta
 *
 * Porque el caso normal es que un pedido CAMBIE, no que aparezca uno nuevo: una factura
 * que llega, un domicilio que se cotiza. Eso no mueve el total, así que contando no se
 * ve. La marca de agua sí.
 *
 * # Sólo los repartibles
 *
 * Los mismos que se avisan —a domicilio y con factura—, con la MISMA regla
 * (`DONDE_ES_PARA_EL_REPARTO`). Si aquí saliera un universo y por el aviso otro, el
 * reparto vería descuadres eternos de pedidos que nunca le van a llegar.
 */
router.get('/orders/resumen', async (req, res) => {
  try {
    const desde = typeof req.query.desde === 'string' ? new Date(req.query.desde) : null;
    const hasta = typeof req.query.hasta === 'string' ? new Date(req.query.hasta) : null;

    if ((desde && isNaN(desde.getTime())) || (hasta && isNaN(hasta.getTime()))) {
      return res.status(400).json({ error: 'Fechas inválidas. Se esperan ISO: ?desde=2025-08-01&hasta=2026-09-26' });
    }

    const rango: Record<string, Date> = {};

    if (desde) rango.gte = desde;
    // `hasta` se entiende INCLUSIVE: quien pide «hasta el 26» quiere el 26 entero, no
    // hasta su medianoche. Pedir un día y que salga vacío es el fallo más tonto de éstos.
    if (hasta) rango.lte = new Date(hasta.getTime() + 24 * 60 * 60 * 1000 - 1);

    const filas = await prisma.pedido.findMany({
      where: { ...DONDE_ES_PARA_EL_REPARTO, ...(desde || hasta ? { fecha: rango } : {}) },
      select: { fecha: true, updatedAt: true },
    });

    /*
     * El día se saca en UTC, y es seguro AQUÍ: `fecha` se guarda a mediodía —12:00,
     * 16:00, 17:00 o 18:00 según de dónde venga el CSV—, nunca cerca de medianoche, así
     * que el día en UTC y el día en Cuba son el mismo. El día que alguien guarde una
     * fecha a las 23:00, esto hay que revisarlo.
     */
    const porDia = new Map<string, { pedidos: number; maxUpdatedAt: Date }>();

    for (const f of filas) {
      const dia = f.fecha.toISOString().slice(0, 10);
      const previo = porDia.get(dia);

      if (!previo) porDia.set(dia, { pedidos: 1, maxUpdatedAt: f.updatedAt });
      else {
        previo.pedidos++;
        if (f.updatedAt > previo.maxUpdatedAt) previo.maxUpdatedAt = f.updatedAt;
      }
    }

    res.json(
      [...porDia.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([dia, v]) => ({ dia, pedidos: v.pedidos, maxUpdatedAt: v.maxUpdatedAt })),
    );
  } catch (e) {
    console.error('[integration] resumen falló:', (e as Error).message);
    res.status(500).json({ error: 'No se pudo armar el resumen.' });
  }
});

/**
 * GET /integration/orders/ids?dia=YYYY-MM-DD   (o ?desde=&hasta=)   (x-api-key)
 *
 * Los ids de un día, con su marca de agua. DOS CAMPOS y nada más.
 *
 * Es el segundo paso de la comparación: del día que no cuadró en `/orders/resumen`, esto
 * dice EXACTAMENTE qué pedidos hay y cuándo se tocó cada uno, para poder pedir enteros
 * sólo los que falten o hayan cambiado. Un día son doscientas filas de dos campos en vez
 * de doscientos pedidos con sus clientes y sus renglones.
 *
 * Mismo universo que el resumen: sólo los repartibles.
 */
router.get('/orders/ids', async (req, res) => {
  try {
    const dia = typeof req.query.dia === 'string' ? req.query.dia.trim() : '';
    let desde: Date | null = null;
    let hasta: Date | null = null;

    if (dia) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
        return res.status(400).json({ error: 'El día va como YYYY-MM-DD.' });
      }
      desde = new Date(`${dia}T00:00:00.000Z`);
      hasta = new Date(`${dia}T23:59:59.999Z`);
    } else {
      desde = typeof req.query.desde === 'string' ? new Date(req.query.desde) : null;
      hasta = typeof req.query.hasta === 'string' ? new Date(req.query.hasta) : null;
      if (hasta) hasta = new Date(hasta.getTime() + 24 * 60 * 60 * 1000 - 1);
    }

    if ((desde && isNaN(desde.getTime())) || (hasta && isNaN(hasta.getTime()))) {
      return res.status(400).json({ error: 'Fechas inválidas.' });
    }
    if (!desde && !hasta) {
      return res.status(400).json({ error: 'Hace falta ?dia= o ?desde=&hasta=. Sin rango esto devolvería el año entero.' });
    }

    const rango: Record<string, Date> = {};

    if (desde) rango.gte = desde;
    if (hasta) rango.lte = hasta;

    const filas = await prisma.pedido.findMany({
      where: { ...DONDE_ES_PARA_EL_REPARTO, fecha: rango },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });

    res.json(filas);
  } catch (e) {
    console.error('[integration] ids falló:', (e as Error).message);
    res.status(500).json({ error: 'No se pudieron listar los ids.' });
  }
});

/**
 * GET /integration/orders/completados?since=<ISO>&limit=1000   (x-api-key)
 * PARA PARRANDA (pull): pedidos COMPLETADOS con la FECHA en que se completaron. Parranda
 * consulta cuándo se hicieron efectivos los pedidos. `since` (opcional) trae solo los
 * completados desde esa fecha (incremental). No necesita webhook/push: ellos consultan.
 */
router.get('/orders/completados', async (req, res) => {
  const sinceRaw = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
  const since = sinceRaw && !isNaN(sinceRaw.getTime()) ? sinceRaw : null;
  const limit = req.query.limit ? Math.min(5000, Math.max(1, Number(req.query.limit))) : 1000;

  const pedidos = await prisma.pedido.findMany({
    where: { completedAt: since ? { gte: since } : { not: null } },
    orderBy: { completedAt: 'desc' },
    take: limit,
    include: {
      cliente: { select: { codigo: true, nombre: true } },
      sucursal: { select: { codigo: true } },
      items: { select: { producto: true, unidades: true, packs: true } },
    },
  });

  const orders = pedidos.map((p) => ({
    folio: p.folio,
    sucursalCodigo: p.sucursal?.codigo || null,
    clienteCodigo: p.cliente?.codigo || null,
    clienteNombre: p.cliente?.nombre || null,
    estado: p.estado,
    completadoEn: p.completedAt,     // fecha en que el pedido se completó/efectivizó
    fecha: p.fecha,
    // SOLO productos Parranda: cerveza (330/500/1500) + Malta Guajira (330/1500).
    productos: p.items
      .map((it) => {
        const c = clasificarParranda(it.producto);
        return c ? { producto: c.producto, formatoMl: c.formatoMl, unidades: it.unidades, packs: it.packs } : null;
      })
      .filter(Boolean),
  }));

  res.json({ count: orders.length, orders });
});

/**
 * GET /integration/clients?sucursalCodigo=XXX&vendedor=andy.almanza   (x-api-key)
 * Clientes GEOLOCALIZADOS (con lat/lng) de la sucursal local. Delivery los espeja
 * localmente para armar órdenes personalizadas SELECCIONANDO el cliente (no recrearlo),
 * ya con su geo → sale el costo. SOLO con geo: sin coordenadas no se puede cotizar el
 * domicilio, así que no tiene sentido traerlos. Mismo scope de sucursal que /orders.
 */
router.get('/clients', async (req, res) => {
  const askedCodigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';
  /**
   * Archivados: por defecto vienen TODOS.
   *
   * Archivar en PEDIDO es esconder de la lista, no borrar, y son 51.871 de 56.208. Quien
   * quiera sólo los vivos que pida `archivado=0`; quien quiera el catálogo entero —que es
   * lo que necesita delivery para planificar rutas de pedidos ya completados— no pide
   * nada. Excluirlos por defecto habría dejado fuera el 92% sin que nadie lo notara.
   */
  const archivado = typeof req.query.archivado === 'string' ? req.query.archivado.trim() : '';
  // Los clientes DE UN VENDEDOR.
  //
  // El cliente no tiene vendedor: la relación vive en los pedidos, así que "los
  // clientes de Andy" son los que alguna vez le compraron a Andy. Se acepta su código
  // ("andy.almanza", que es como lo nombra el CSV y la gente) o su id.
  //
  // Sirve para que una tablet se traiga SOLO su cartera en vez de los 8.850 clientes
  // de la sucursal: un repartidor no visita a los de otro.
  const vendedor = typeof req.query.vendedor === 'string' ? req.query.vendedor.trim() : '';
  // Incremental, igual que en /orders: lo que cambió desde la última sincronización.
  //
  // Sin esto, refrescar la cartera obliga a bajársela entera aunque no se haya movido
  // un dato. Con 8.850 clientes y datos móviles, eso es un minuto largo cada vez para,
  // casi siempre, no traer nada.
  const since = typeof req.query.since === 'string' ? req.query.since : '';
  /**
   * `?ids=a,b,c` — ESTOS clientes y ninguno más.
   *
   * Lo pide el reparto desde que PEDIDO avisa de que un cliente se movió: el aviso trae
   * el id del cliente, y sin esto lo mejor que se podía hacer con ese id en la mano era
   * un `since` corto de su sucursal, que arrastra a todos los que se movieron en esa
   * ventana para quedarse con uno.
   *
   * Tope de 200 por llamada: la lista viaja en la URL y una URL sin límite es un 414 el
   * día que alguien pida mil, que además es el día en que más falta hace que funcione.
   */
  const ids = (typeof req.query.ids === 'string' ? req.query.ids : '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 200);

  const localSucursalId = readConfiguredSucursalId();
  let sucursalScope: Record<string, unknown> = {};
  if (localSucursalId) {
    sucursalScope = { sucursalId: localSucursalId };
    if (askedCodigo) {
      const local = await prisma.sucursal.findUnique({ where: { id: localSucursalId } });
      if (local?.codigo && local.codigo !== askedCodigo) {
        return res.status(403).json({
          error: `Esta instalación es de la sucursal '${local.codigo}', no '${askedCodigo}'.`,
        });
      }
    }
  } else if (askedCodigo) {
    sucursalScope = { sucursal: { codigo: askedCodigo } };
  }

  // Paginación OPCIONAL por cursor. Sin `limit` se devuelve todo, igual que
  // siempre: un cliente viejo que no sepa paginar sigue funcionando tal cual.
  // Importa porque delivery BORRA de su espejo los clientes que no vengan en
  // la respuesta; si un cliente antiguo recibiera solo la primera página,
  // borraría el resto.
  const limitRaw = req.query.limit ? Number(req.query.limit) : null;
  const limit = limitRaw && Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 2000)
    : null;
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
  /**
   * PAGINAR ES OPT-IN, y tiene que serlo desde la PRIMERA página.
   *
   * Si la página 1 saliera ordenada por fecha y la 2 por id, unos pedidos se repetirían
   * y otros no saldrían nunca: paginar por un campo que no es único es el fallo clásico
   * de esto. Y el cursor sólo aparece a partir de la página 2, así que no sirve para
   * decidir el orden de la primera.
   *
   * Por eso hay un interruptor propio: `paginar=1`. Con él, todo el recorrido va por id
   * ascendente de principio a fin. Sin él, no cambia absolutamente nada para quien ya
   * está llamando a esto —mismo orden, lo más nuevo primero—, que es lo que no se puede
   * romper.
   */
  const paginar = req.query.paginar === '1' || req.query.paginar === 'true' || !!cursor;

  // TODOS los clientes, no sólo los geolocalizados.
  //
  // Antes se filtraban por tener coordenadas, con el argumento de que sin ellas no hay
  // domicilio que calcular. Pero eso mezcla dos cosas: quién ES cliente de la sucursal,
  // y a quién se le puede cotizar hoy. En La Habana son 783 clientes y salían 599 — los
  // otros 184 sencillamente no existían para quien consumiera esto, y no había forma de
  // saber que faltaban.
  //
  // Quien necesite sólo los cotizables mira `latitud`, que viene en cada fila, o pide
  // `?conGeo=1`. Es mejor que le llegue el cliente y decida, a que se lo escondamos.
  const soloConGeo = req.query.conGeo === '1' || req.query.conGeo === 'true';

  const clientes = await prisma.cliente.findMany({
    where: {
      ...sucursalScope,
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(soloConGeo ? { latitud: { not: null }, longitud: { not: null } } : {}),
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
      // Por vendedor: los que tienen ALGÚN pedido suyo.
      ...(vendedor
        ? {
            pedidos: {
              some: {
                vendedor: {
                  OR: [{ codigo: vendedor }, { id: vendedor }],
                },
              },
            },
          }
        : {}),
    },
    include: { sucursal: { select: { codigo: true, nombre: true } } },
    // Al paginar se ordena por id: es único y estable, así ninguna fila se
    // repite ni se pierde entre páginas aunque cambien los nombres mientras
    // se recorre. Sin paginar se conserva el orden por nombre de siempre.
    orderBy: limit ? { id: 'asc' } : { nombre: 'asc' },
    ...(limit ? { take: limit } : {}),
    ...(limit && cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  // De quién es cada cliente.
  //
  // El cliente no tiene vendedor propio: esa relación vive en los pedidos. Se
  // resuelve aquí, para la página que se va a devolver, en UNA consulta: pedirlo
  // cliente por cliente serían 500 consultas para pintar 500 filas.
  //
  // OJO: ver la nota "PENDIENTE DE DECISIÓN" en routes/clientes.ts. Este `vendedor` es
  // el que Entrega guarda como `usuario_vendedor`, así que si allí se cambia el
  // criterio hay que cambiarlo aquí en la misma tanda: si no, el panel y la APK dirán
  // cosas distintas del mismo cliente y nadie sabrá cuál creer.
  //
  // `vendedor` es QUIEN LE VENDE AHORA —el de su pedido más reciente—, que es el mismo
  // criterio que usa la lista de clientes del panel. `vendedores` son todos los que le
  // han vendido: un cliente puede comprarle a dos, y quedarse sólo con uno sería decidir
  // desde aquí a quién le toca la entrega.
  const idsClientes = clientes.map((c) => c.id);

  // Qué pares (cliente, vendedor) existen, y desde cuándo.
  //
  // En SQL y con DISTINCT ON porque la diferencia es de dos órdenes de magnitud:
  // traerse los pedidos de 500 clientes de Camagüey son decenas de miles de filas
  // para acabar quedándose con una o dos por cliente —la primera versión tardaba
  // veinte segundos y no llegaba a contestar—. Esto devuelve ya sólo el par, con la
  // fecha de su pedido más RECIENTE con ese vendedor: unas 600 filas.
  const pares = idsClientes.length
    ? await prisma.$queryRaw<Array<{ clienteId: string; vendedorId: string; hasta: Date }>>`
        SELECT DISTINCT ON ("clientId", "sellerId")
               "clientId" AS "clienteId", "sellerId" AS "vendedorId", fecha AS hasta
          FROM "Order"
         WHERE "clientId" = ANY(${idsClientes}::text[])
           AND "sellerId" IS NOT NULL
         ORDER BY "clientId", "sellerId", fecha DESC`
    : [];

  // Los vendedores que salgan, una vez cada uno: son unas decenas aunque los clientes
  // sean miles.
  const idsVendedores = [...new Set(pares.map((r) => r.vendedorId))];
  const vendedores = idsVendedores.length
    ? await prisma.vendedor.findMany({
        where: { id: { in: idsVendedores } },
        select: {
          id: true, codigo: true, nombre: true,
          sucursal: { select: { id: true, codigo: true, nombre: true } },
          gestor: {
            select: {
              id: true, username: true,
              sucursal: { select: { id: true, codigo: true, nombre: true } },
            },
          },
        },
      })
    : [];

  type Vend = (typeof vendedores)[number];
  const comoSale = (v: Vend) => ({
    id: v.id,
    codigo: v.codigo,
    nombre: v.nombre,
    // La sucursal del vendedor, y la de su gestor. Normalmente son la misma; cuando
    // no lo son es que el vendedor está mal colocado, y verlo es mejor que que la APK
    // atribuya la entrega a la sucursal equivocada sin que nadie se entere.
    sucursalId: v.sucursal?.id ?? null,
    sucursalCodigo: v.sucursal?.codigo ?? null,
    sucursalNombre: v.sucursal?.nombre ?? null,
    gestor: v.gestor
      ? {
          id: v.gestor.id,
          usuario: v.gestor.username,
          sucursalId: v.gestor.sucursal?.id ?? null,
          sucursalCodigo: v.gestor.sucursal?.codigo ?? null,
          sucursalNombre: v.gestor.sucursal?.nombre ?? null,
        }
      : null,
  });

  const porId = new Map(vendedores.map((v) => [v.id, comoSale(v)]));

  /**
   * QUIÉN LE VENDE AHORA: el vendedor de su pedido más reciente.
   *
   * Esto es lo que Entrega guarda como `usuario_vendedor`, o sea de quién es el cliente en
   * la APK. Tiene que decir LO MISMO que la lista de clientes del panel —ver la nota
   * larga en `routes/clientes.ts`—: si uno mira el más reciente y el otro el más antiguo,
   * el panel y la APK dicen cosas distintas del mismo cliente.
   *
   * Antes era quien lo TRAJO, y con eso 849 clientes de 9.155 salían atribuidos a un
   * vendedor que ya no les vende. En la práctica: no aparecían en la cartera del que sí
   * los atiende, así que en Entrega no existían para él.
   */
  const leVendeAhora = new Map<string, { hasta: Date; vend: ReturnType<typeof comoSale> }>();
  const todosSus = new Map<string, Array<ReturnType<typeof comoSale>>>();
  for (const r of pares) {
    const v = porId.get(r.vendedorId);
    if (!v) continue;
    const previo = leVendeAhora.get(r.clienteId);
    if (!previo || r.hasta > previo.hasta) leVendeAhora.set(r.clienteId, { hasta: r.hasta, vend: v });
    if (!todosSus.has(r.clienteId)) todosSus.set(r.clienteId, []);
    todosSus.get(r.clienteId)!.push(v);
  }

  const clients = clientes.map((c) => ({
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    zona: c.zona,
    direccion: c.direccion,
    municipio: c.municipio,
    tipoCliente: c.tipoCliente,
    estadoCompra: c.estadoCompra,
    latitud: c.latitud,
    longitud: c.longitud,
    geolocalizacion: c.geolocalizacion,
    // La distancia que ya se calculó para este cliente, si alguien la calculó. Se
    // devuelve para que la APK no vuelva a medir lo que ya está medido — y para que
    // sepa DESDE DÓNDE se midió: si el almacén cambió de sitio, ese número hay que
    // rehacerlo.
    distanciaKm: c.distanciaKm,
    distanciaDesde: c.distanciaDesde,
    distanciaAt: c.distanciaAt,
    sucursalId: c.sucursalId,
    sucursalCodigo: c.sucursal?.codigo || null,
    sucursalNombre: c.sucursal?.nombre || null,
    // Quién le vende ahora, con su sucursal y su gestor.
    vendedor: leVendeAhora.get(c.id)?.vend ?? null,
    // Y todos los que le han vendido, por si le compra a más de uno.
    vendedores: todosSus.get(c.id) ?? [],
    // Para que la tablet sepa por dónde seguir en la próxima sync.
    updatedAt: c.updatedAt,
  }));

  // nextCursor solo aparece si se pidió paginación Y la página vino llena:
  // una página incompleta significa que ya no queda nada más.
  const nextCursor = limit && clientes.length === limit
    ? clientes[clientes.length - 1].id
    : null;

  res.json({ count: clients.length, clients, ...(limit ? { nextCursor } : {}) });
});

/**
 * La puerta por la que delivery escribía el costo de domicilio: BORRADA.
 *
 * El costo lo pone la APK, por el webhook, que además guarda la tasa con la que cotizó
 * y deja rastro de quién movió al cliente. Esta ruta escribía el campo directamente,
 * sin nada de eso, y ya no la llamaba nadie.
 *
 * Se quita en vez de dejarla ahí sin usar porque una ruta viva es una ruta que alguien
 * puede llamar: cualquiera con la clave de servicio podía pisar en silencio el precio
 * que la APK acababa de calcular, y no habría quedado ni rastro de que pasó.
 */

/**
 * GET /integration/client-order-counts
 * Cantidad de pedidos por cliente (para la columna "pedidos" de analitics).
 * Devuelve [{ nombre, pedidos }]. Scopeado a la sucursal local.
 */
router.get('/client-order-counts', async (req, res) => {
  const localSucursalId = readConfiguredSucursalId();
  const where = localSucursalId
    ? { sucursalId: localSucursalId, clienteId: { not: null } }
    : { clienteId: { not: null } };

  const grouped = await prisma.pedido.groupBy({
    by: ['clienteId'],
    where,
    _count: { _all: true },
  });

  const clienteIds = grouped.map((g) => g.clienteId).filter((x): x is string => !!x);
  const clientes = await prisma.cliente.findMany({
    where: { id: { in: clienteIds } },
    select: { id: true, nombre: true },
  });
  const nombreById = new Map(clientes.map((c) => [c.id, c.nombre]));

  const counts = grouped
    .map((g) => ({ nombre: g.clienteId ? nombreById.get(g.clienteId) || '' : '', pedidos: g._count._all }))
    .filter((x) => x.nombre);

  res.json({ count: counts.length, counts });
});

/**
 * GET /integration/vendedores?sucursalCodigo=XXX&activos=1   (x-api-key)
 *
 * El MAESTRO de vendedores, entero. No los que han hecho pedidos: todos.
 *
 * # Para qué
 *
 * Rutas identifica a sus vendedores por el nombre de una carpeta de Drive
 * («ALEXANDER», «STGTadyslai», «TABLET3») y aquí se llaman como los llamó el maestro
 * («andy.almanza», «ALEXANDER RODRÍGUEZ»). Para cruzar los pedidos con el recorrido
 * hay que emparejar las dos listas, y eso lo hace una persona una vez por vendedor.
 *
 * Deducir la lista de los PEDIDOS no vale: quien está emparejando necesita ver a
 * TODOS —también al que todavía no ha vendido nada, y al que lleva un mes sin
 * pedidos— y si no, se queda esperando a que aparezcan para poder decir quiénes son.
 *
 * Es de solo lectura y no toca nada. La sucursal se scopea igual que en /orders y
 * /clients: cada instalación entrega lo suyo.
 */
router.get('/vendedores', async (req, res) => {
  const askedCodigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';
  /**
   * Archivados: por defecto vienen TODOS.
   *
   * Archivar en PEDIDO es esconder de la lista, no borrar, y son 51.871 de 56.208. Quien
   * quiera sólo los vivos que pida `archivado=0`; quien quiera el catálogo entero —que es
   * lo que necesita delivery para planificar rutas de pedidos ya completados— no pide
   * nada. Excluirlos por defecto habría dejado fuera el 92% sin que nadie lo notara.
   */
  const archivado = typeof req.query.archivado === 'string' ? req.query.archivado.trim() : '';
  // Por defecto SOLO los activos: un vendedor de baja no tiene a quién emparejar y
  // ensucia la lista. Con activos=0 salen todos, para revisar un histórico.
  const soloActivos = req.query.activos !== '0' && req.query.activos !== 'false';

  const localSucursalId = readConfiguredSucursalId();
  let sucursalScope: Record<string, unknown> = {};
  if (localSucursalId) {
    sucursalScope = { sucursalId: localSucursalId };
    if (askedCodigo) {
      const local = await prisma.sucursal.findUnique({ where: { id: localSucursalId } });
      if (local?.codigo && local.codigo !== askedCodigo) {
        return res.status(403).json({
          error: `Esta instalación es de la sucursal '${local.codigo}', no '${askedCodigo}'.`,
        });
      }
    }
  } else if (askedCodigo) {
    sucursalScope = { sucursal: { codigo: askedCodigo } };
  }

  const vendedores = await prisma.vendedor.findMany({
    where: { ...sucursalScope, ...(soloActivos ? { activo: true } : {}) },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      activo: true,
      sucursalId: true,
      sucursal: { select: { codigo: true, nombre: true } },
      // Cuántos pedidos lleva: es lo que dice si un emparejamiento importa mucho o
      // poco, y quien está emparejando agradece verlo para empezar por los gordos.
      _count: { select: { pedidos: true } },
    },
    orderBy: { nombre: 'asc' },
  });

  const sellers = vendedores.map((v) => ({
    id: v.id,
    codigo: v.codigo,
    nombre: v.nombre,
    activo: v.activo,
    sucursalId: v.sucursalId,
    sucursalCodigo: v.sucursal?.codigo ?? null,
    sucursalNombre: v.sucursal?.nombre ?? null,
    pedidos: v._count.pedidos,
  }));

  res.json({ count: sellers.length, sellers });
});

/** Los tres estados que puede tener un pedido frente a su factura. Nada más. */
const ESTADOS_FACTURA = new Set(['igual', 'cambiado', 'sin_factura']);

/**
 * POST /integration/orders/invoicing — alguien de fuera dice qué pasó con la FACTURA.
 *
 * Body: { facturas: [{ pedidoId?, folio?, vendedorCodigo?, estado, numero?, costo?, distanciaKm? }] }
 *
 * # Quién lo llama
 *
 * Hoy, nadie: PEDIDO se entera solo. Ventra es un ERP detrás de una VPN que no avisa a
 * nadie, así que hay que preguntarle, y eso lo hace `lib/cotejoFacturacion` cada diez
 * minutos, sucursal por sucursal.
 *
 * Esta puerta existe para el día en que FACTURACIÓN pueda avisar ella misma, que es como
 * tendría que ser: el que factura sabe que facturó en el momento en que lo hace, y el
 * sondeo se puede apagar. Mientras tanto se queda abierta y probada — con la clave de
 * servicio, que no la tiene cualquiera— porque montarla el día que haga falta cuesta
 * mucho más que dejarla puesta.
 *
 * Escribe lo mismo que el sondeo (`facturaEstado`, `facturaNumero`, `facturaAt`), así que
 * los dos caminos dejan el pedido igual. Lo que NO hace es corregir las líneas del pedido:
 * eso sólo lo hace el cotejo, que es quien ha visto la factura entera.
 *
 * # Y el costo del domicilio
 *
 * Si la factura cambió lo que se lleva, el domicilio ya no vale lo que valía: se cobra
 * por peso. Quien avise puede mandar el `costo` recalculado, y aquí entra por
 * `aplicarCostoDomicilio` — la MISMA función por la que entra el de Entrega. Una sola
 * puerta para el costo: dos caminos distintos para escribir el mismo número acaban
 * discrepando, y el que discrepa es el que se cobra.
 *
 * En LOTE e idempotente: mandar dos veces lo mismo deja lo mismo. Cada pedido se responde
 * por separado —qué se guardó y qué no, con el motivo— en vez de fallar el lote entero.
 */
router.post('/orders/invoicing', async (req, res) => {
  const cuerpo = req.body || {};
  const facturas: any[] = Array.isArray(cuerpo.facturas)
    ? cuerpo.facturas
    : Array.isArray(cuerpo) ? cuerpo : cuerpo.estado ? [cuerpo] : [];

  if (facturas.length === 0) {
    return res.status(400).json({ error: 'No vino ninguna. Se espera { facturas: [{ pedidoId, estado }] }.' });
  }
  if (facturas.length > 500) {
    return res.status(413).json({ error: 'Máximo 500 pedidos por llamada.' });
  }

  // Cada instalación de PEDIDO es de UNA sucursal: un delivery de otra no escribe aquí.
  const local = readConfiguredSucursalId();
  const alcance = local ? { sucursalId: local } : {};

  const aplicadas: Array<{ pedidoId: string; folio: string; guardado: string[] }> = [];
  const rechazadas: Array<{ pedidoId?: string; folio?: string; motivo: string }> = [];
  const tocados: Array<{ id: string; sucursalId: string | null }> = [];

  for (const f of facturas) {
    if (!f || typeof f !== 'object') {
      rechazadas.push({ motivo: 'entrada no es un objeto' });
      continue;
    }

    const estado = typeof f.estado === 'string' ? f.estado.trim() : '';
    if (!ESTADOS_FACTURA.has(estado)) {
      rechazadas.push({
        pedidoId: f.pedidoId,
        folio: f.folio,
        motivo: `estado '${estado}' desconocido (igual | cambiado | sin_factura)`,
      });
      continue;
    }

    try {
      /**
       * Se busca por id, y si no, por folio.
       *
       * Delivery guarda el id de aquí en cada pedido que copia, así que el camino normal
       * es directo y sin ambigüedad. El folio queda de respaldo y NO es único —la clave
       * real es sucursal+folio+vendedor—, así que sin vendedor se rechaza en vez de
       * escribir en el pedido de otro.
       */
      const pedido = f.pedidoId
        ? await prisma.pedido.findFirst({ where: { id: String(f.pedidoId), ...alcance } })
        : f.folio && f.vendedorCodigo
          ? await prisma.pedido.findFirst({
              where: { folio: String(f.folio), vendedor: { codigo: String(f.vendedorCodigo) }, ...alcance },
            })
          : null;

      if (!pedido) {
        rechazadas.push({
          pedidoId: f.pedidoId,
          folio: f.folio,
          motivo: f.pedidoId || f.folio ? 'no existe aquí (¿otra sucursal?)' : 'falta pedidoId o folio+vendedorCodigo',
        });
        continue;
      }

      const guardado: string[] = [];

      /**
       * Sólo se escribe si CAMBIÓ algo.
       *
       * `updatedAt` es la marca de agua con la que las tablets y el propio delivery
       * sincronizan lo que se movió. Reescribir el mismo estado cada minuto lo movería
       * todo el rato, y cada tablet se traería el día entero por datos móviles para
       * enterarse de que no había ninguna novedad.
       */
      const numero = f.numero ? String(f.numero) : null;
      // Con factura, el pedido está completado — y da igual que la factura entre por aquí
      // o por el cotejo contra Ventra: la regla es la misma función para los dos, porque
      // dos copias acabarían completando distinto según por dónde hubiera entrado.
      const completar = camposParaCompletar(estado, pedido.estado);

      if (pedido.facturaEstado !== estado || pedido.facturaNumero !== numero || completar) {
        await prisma.pedido.update({
          where: { id: pedido.id },
          data: { facturaEstado: estado, facturaNumero: numero, facturaAt: new Date(), ...(completar || {}) },
        });
        guardado.push('factura');
        if (completar) {
          guardado.push('completado');
        }
      }

      /**
       * Y el costo recalculado, si vino.
       *
       * Va por `aplicarCostoDomicilio` —la puerta de Entrega— para que la tasa se estampe
       * igual, la distancia se guarde en el cliente igual, y sea idempotente igual.
       */
      /**
       * Ojo con el nulo: `Number(null)` es CERO, no NaN.
       *
       * Delivery manda `costo: null` en todos los pedidos cuya factura no cambió el peso
       * —que son casi todos—. Comprobando sólo `Number.isFinite`, cada pasada habría
       * puesto el domicilio a cero en el día entero, y un domicilio en cero no parece un
       * dato que falta: parece un domicilio gratis.
       */
      const costo = f.costo == null || f.costo === '' ? NaN : Number(f.costo);
      if (Number.isFinite(costo) && costo >= 0 && costo !== pedido.costoDomicilio) {
        const r = await aplicarCostoDomicilio({
          pedidoId: pedido.id,
          costo,
          distanciaKm: Number.isFinite(Number(f.distanciaKm)) ? Number(f.distanciaKm) : null,
          distanciaDesde: f.distanciaDesde ?? null,
        });
        if (r.ok && r.cambios?.costo) guardado.push('costo');
        else if (!r.ok) rechazadas.push({ pedidoId: pedido.id, folio: pedido.folio, motivo: `costo: ${r.motivo}` });
      }

      if (guardado.length) tocados.push({ id: pedido.id, sucursalId: pedido.sucursalId });
      aplicadas.push({ pedidoId: pedido.id, folio: pedido.folio, guardado });
    } catch (err) {
      rechazadas.push({ pedidoId: f.pedidoId, folio: f.folio, motivo: (err as Error).message });
    }
  }

  // Que se vea sin que nadie recargue. El pedido viaja completo, con la misma forma que
  // los de la lista: la vista sustituye su fila y ya.
  for (const t of tocados) {
    emitEvent('pedido', { id: t.id, sucursalId: t.sucursalId, accion: 'update', datos: await pedidoParaLista(t.id) });
    // Ya tiene precio de domicilio: es repartible y el reparto lo quiere ver.
    avisarAlReparto({ id: t.id, sucursalId: t.sucursalId, motivo: 'domicilio', accion: 'update' });
  }

  res.json({
    ok: rechazadas.length === 0,
    recibidas: facturas.length,
    aplicadas,
    rechazadas,
  });
});

/**
 * Los estados del REPARTO. Los pone delivery, que es quien los ve pasar.
 *
 *   despachado   — se cargó en el camión.
 *   en_transito  — el camión salió.
 *   entregado    — se le dio al cliente.
 *   devuelto     — volvió al almacén: el cliente no lo quiso.
 *   cancelado    — se canceló antes de salir o durante el reparto.
 */

/**
 * POST /integration/orders/status — en qué punto del reparto va cada pedido.
 *
 * Body: { pedidos: [{ pedidoId, estado, nota?, at? }] }
 *
 * # Por qué no se toca `estado`
 *
 * El `estado` de PEDIDO manda sobre el archivado, sobre el expirado y sobre todos los
 * filtros de la lista. Metiéndole «en tránsito» se rompen los tres a la vez. Y encima son
 * dos cosas distintas: un pedido puede estar completado aquí y seguir dando vueltas en el
 * camión. Así que esto va en su propio campo y no pisa nada.
 *
 * # Devuelto y cancelado NO tocan el inventario
 *
 * El reintegro lo hace Ventra. Aquí sólo se deja constancia de que ese pedido volvió, y
 * quien lleva la cuenta de lo que baja del camión es el logístico. Poner el estado
 * esperando que el stock vuelva solo es contar con algo que no pasa.
 */
router.post('/orders/status', async (req, res) => {
  const pedidos = comoVengan(req.body);

  if (pedidos.length === 0) {
    return res.status(400).json({ error: 'No vino ninguno. Se espera { pedidos: [{ pedidoId, estado }] }.' });
  }
  if (pedidos.length > TOPE_POR_LLAMADA) {
    return res.status(413).json({ error: `Máximo ${TOPE_POR_LLAMADA} pedidos por llamada.` });
  }

  res.json(await aplicarEstadosDeEntrega(pedidos, pedidoParaLista));
});

/**
 * GET /integration/ventra/sales?database=&from=&to=&limit=5 — lo que manda Ventra, crudo.
 *
 * Sólo lee. Existe para poder MIRAR lo que llega en vez de suponerlo: el cotejo depende de
 * que la nota de la factura traiga el folio del pedido, y averiguar si lo trae —y con qué
 * nombre viene esa columna— no se puede hacer desde fuera de la VPN.
 *
 * Devuelve las filas ya mapeadas, con la nota y el folio que se le saca, para ver de un
 * vistazo si el emparejado va a funcionar.
 */
router.get('/ventra/sales', async (req, res) => {
  try {
    const database = String(req.query.database || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || from).trim();
    const limit = Math.min(Number(req.query.limit) || 5, 50);

    if (!database) {
      const bases = await databases();

      return res.json({
        error: 'Falta `database`. Estas son las que hay:',
        bases: bases.map((b) => ({ database: b.database, sucursal: b.branchName })),
      });
    }
    if (!from) return res.status(400).json({ error: 'Falta `from` (YYYY-MM-DD).' });

    const ventas = await ventasDeSucursal(database, from, to, 500);

    res.json({
      database,
      lineas: ventas.length,
      conNota: ventas.filter((v) => v.nota).length,
      conFolio: ventas.filter((v) => folioDeLaNota(v.nota)).length,
      muestra: ventas.slice(0, limit).map((v) => ({
        factura: v.operNumber,
        fecha: v.fecha,
        cliente: v.clienteNombre,
        producto: v.productoNombre,
        cantidad: v.cantidad,
        nota: v.nota,
        folioQueSeSaca: folioDeLaNota(v.nota),
      })),
    });
  } catch (e) {
    res.status(502).json({ error: `No se pudo preguntar a Ventra: ${(e as Error).message}` });
  }
});

export default router;
