import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import { catalogoDeSucursal, unidadesDeVenta } from '../lib/catalogoSucursal';
import { mapCsvRecords, type OrderRecordDto } from '../dto/orderRecord.dto';
import {
  requireSucursalId,
  resolveSucursalFilter,
  resolveSucursalScope,
  getRequesterContext,
} from '../lib/sucursalContext';
import { nombreComparable, codigoComparable } from '../lib/nombreVendedor';
import { parsearFechaConsulta } from '../lib/fechaConsulta';
import { notifyPedidoCompletado } from '../lib/webhook';
import { emitEvent } from '../lib/events';
import { redisEnabled, publishJSON, getSubscriber, CH_IMPORT_DONE, CH_IMPORT_FAILED } from '../lib/redis';
import { importQueue } from '../lib/queues';
import { mintSseTicket, consumeSseTicket } from '../lib/sseTickets';
import { ingestaAuth } from '../middleware/ingestaAuth';


const router = Router();

// Las mismas tablas de acentos que usan los índices trigram de la búsqueda. Tienen
// que coincidir EXACTAMENTE con las de los índices: si no, Postgres los ignora.
const CON_TILDE = 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖ';
const SIN_TILDE = 'AEIOUUNAEIOUAEIO';

/** Quita las tildes de un término ya en mayúsculas, igual que hace translate() en SQL. */
function quitarTildes(texto: string): string {
  let salida = '';

  for (const c of texto) {
    const i = CON_TILDE.indexOf(c);

    salida += i >= 0 ? SIN_TILDE[i] : c;
  }

  return salida;
}

// Estado derivado de un pedido (compartido por el SSE y el publish de Redis).
function computeEstado(o: { estado: string | null; fecha_comprometida: Date | null }): string {
  if (o.estado === 'completada') return 'completada';
  if (o.fecha_comprometida && new Date(o.fecha_comprometida) < new Date()) return 'expirada';
  return 'en_proceso';
}

/**
 * El pedido con EXACTAMENTE la forma que devuelve GET / (items + cliente +
 * vendedor + estado derivado). Es lo que viaja por SSE: con esto la vista lo
 * inserta o lo sustituye en la lista que ya tiene, sin pedir nada al servidor.
 */
/**
 * Le pone precio a las líneas de un pedido y calcula su total.
 *
 * El precio sale del catálogo de LA SUCURSAL DEL PEDIDO: el mismo producto no vale lo
 * mismo en Camagüey que en Santiago, así que un precio "del producto" a secas sería
 * mentira en nueve sucursales de diez.
 *
 * Se cruza por NOMBRE y no por código porque el código de la línea viene del CSV de
 * Parranda y el de Ventra es su sku: son dos numeraciones distintas. El nombre sí
 * coincide, que es como lo escribe la gente en los dos sitios.
 *
 * Lo que no cruza se queda con precio nulo y CUENTA como no valorado. Poner cero sería
 * peor: un total que parece completo y no lo es no hay quien lo detecte.
 */
type PedidoConLineas = {
  sucursalId: string | null;
  costoDomicilio: number | null;
  estado: string | null;
  fecha_comprometida: Date | null;
  items: Array<{ producto: string; unidades: number; packs: number | null }>;
};

export async function conPrecios<T extends PedidoConLineas>(pedido: T) {
  if (!pedido.sucursalId) return { ...pedido, total: null, lineasSinPrecio: pedido.items.length };

  const nombres = [...new Set(pedido.items.map((i) => i.producto).filter(Boolean))];
  if (nombres.length === 0) return { ...pedido, total: pedido.costoDomicilio ?? 0, lineasSinPrecio: 0 };

  /**
   * El catálogo de esa sucursal, cruzado en `lib/catalogoSucursal`.
   *
   * Todo lo que había aquí —normalizar los nombres, los vínculos a mano, el desempate
   * del producto duplicado— estaba también, y distinto, en `/integration/orders`. Ahora
   * es el mismo código: lo que se ve en pantalla y lo que se le manda a delivery salen
   * de la MISMA fila, que es lo único que garantiza que no discrepen.
   */
  const catalogo = await catalogoDeSucursal(pedido.sucursalId);

  let total = 0;
  let sinPrecio = 0;
  const items = pedido.items.map((i) => {
    const c = catalogo.buscar(i.producto);
    const precioUnidad = c?.precio ?? null;
    // El precio de Ventra es por UNIDAD DE VENTA (el pack/caja), igual que el peso.
    // Multiplicarlo por las unidades sueltas daría un total disparatado.
    const cantidad = unidadesDeVenta(i.packs, i.unidades);
    const importe = precioUnidad != null ? Number((precioUnidad * cantidad).toFixed(2)) : null;

    if (importe == null) sinPrecio++;
    else total += importe;

    /**
     * El peso, igual que el precio: por UNIDAD DE VENTA y por la línea entera.
     *
     * Se calcula aquí y no en la pantalla porque la regla —el peso de Ventra es del
     * formato, no de la unidad suelta— es la misma que hace que el importe multiplique
     * por los formatos. Teniéndola en dos sitios, un día uno de los dos la cambia.
     */
    const pesoKg = c?.pesoKg ?? null;

    return {
      ...i,
      precioUnidad,
      importe,
      pesoKg,
      pesoLineaKg: pesoKg != null ? Number((pesoKg * cantidad).toFixed(3)) : null,
      stock: c?.stock ?? null,
    };
  });

  if (pedido.costoDomicilio != null) total += pedido.costoDomicilio;

  return {
    ...pedido,
    items,
    // null cuando NINGUNA línea tiene precio: un total de 0 se lee como "gratis".
    total: sinPrecio === pedido.items.length ? null : Number(total.toFixed(2)),
    lineasSinPrecio: sinPrecio,
  };
}

/**
 * Un pedido con la MISMA forma que los de la lista, para mandarlo por SSE.
 *
 * El `conPrecios` es imprescindible y faltaba. El objeto que viaja por SSE no se añade
 * a la lista: la REEMPLAZA. Así que un pedido que entraba en vivo pisaba su fila con
 * una versión sin `precioUnidad`, sin `importe` y sin `total`, y la pantalla lo pintaba
 * como si en esa sucursal no hubiera ninguno de sus productos.
 *
 * Lo malo es cómo se veía: no fallaba nada, no había error en ningún log, y el pedido
 * recién llegado —justo el que alguien está mirando— salía con «no hay en esta
 * sucursal» en todas las líneas mientras el mismo pedido, al recargar la página,
 * aparecía con sus precios. Nada apuntaba al aviso en vivo.
 *
 * Cualquier cosa que se añada a la respuesta de la lista hay que añadirla también aquí,
 * o vuelve a pasar lo mismo con el campo nuevo.
 */
export async function pedidoParaLista(id: string) {
  const o = await prisma.pedido.findUnique({
    where: { id },
    include: { items: true, cliente: true, vendedor: true },
  });
  if (!o) return null;

  return { ...(await conPrecios(o)), estado: computeEstado(o) };
}

// List orders with pagination and filters.
// Lectura: el Super Admin sin sucursal elegida ve TODAS; si elige una (x-sucursal-id)
// se enfoca solo en esa. El resto de usuarios, siempre la suya.
router.get('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError, status: sucursalStatus } = resolveSucursalFilter(req);
    if (sucursalError) {
      return res.status(sucursalStatus ?? 400).json({ error: sucursalError });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const estado = req.query.estado as string | undefined;
    const search = req.query.search as string | undefined;
    const fechaDesde = req.query.fechaDesde as string | undefined;
    const fechaHasta = req.query.fechaHasta as string | undefined;
    const domicilio = req.query.domicilio as string | undefined;
    // Filtro por PRODUCTO: el nombre exacto que se eligió en el selector. Es distinto
    // de la búsqueda libre —que busca ese texto en media docena de sitios—: aquí se
    // pide "enséñame los pedidos que llevan ESTO", que es lo que se necesita cuando
    // falta mercancía y hay que avisar a quien la pidió.
    const producto = req.query.producto as string | undefined;
    // Filtro por "vendedor" = el USUARIO/gestor vinculado (ver GET /vendedores). Se
    // filtra por los pedidos de los vendedores que ese usuario gestiona.
    const usuarioId = (req.query.usuarioId || req.query.vendedorId) as string | undefined;
    const incluirArchivados = req.query.incluirArchivados === '1' || req.query.incluirArchivados === 'true';
    const searchTerm = search ? search.toUpperCase() : undefined;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = { sucursalId };
    const conditions: any[] = [];

    // RBAC — rol GESTOR: SOLO ve SUS pedidos (los de su vendedor vinculado por gestorId).
    // Nunca ve los de compañeros, aunque sean de su misma sucursal.
    const gestorCtx = getRequesterContext(req);
    if (gestorCtx.isGestor && gestorCtx.userId) {
      conditions.push({ vendedor: { gestorId: gestorCtx.userId } });
    }

    // Archivados (completados + expirados con +1 semana): OCULTOS por defecto para que la
    // lista solo acumule los "en proceso".
    //  - estado='archivados' -> muestra SOLO los archivados (vista/histórico dedicado).
    //  - incluirArchivados=1  -> incluye archivados en la búsqueda actual (toggle).
    //  - por defecto -> se ocultan.
    if (estado === 'archivados') {
      where.archivedAt = { not: null };
    } else if (!incluirArchivados) {
      where.archivedAt = null;
    }

    // Búsqueda general TILDE-insensible (jose == josé, ramon == ramón) sobre cliente,
    // encargado, vendedor, folio, código Parranda y PRODUCTO a la vez — así da igual
    // buscar por nombre, apellido, encargado, folio o lo que se pidió: se distingue
    // solo por lo que matchea.
    // Prisma no soporta unaccent, así que se hace un query crudo que quita las tildes con
    // translate() y devuelve los ids que matchean; el query principal aplica el scope de
    // sucursal + filtros + paginación sobre esos ids (nunca fuga entre sucursales).
    if (searchTerm) {
      // Una condición POR COLUMNA, no sobre la concatenación de las cinco. La
      // concatenación no la puede indexar nadie: cada búsqueda recorría los 44.700
      // pedidos enteros (medido: 418 millones de filas leídas en escaneos completos).
      // Separadas, cada una tiene su índice trigram y Postgres las combina.
      //
      // Las tablas de acentos van como literales (Prisma.raw), NO como parámetros:
      // el índice se creó con esa expresión exacta y si no coincide carácter por
      // carácter, Postgres lo ignora y volvemos al escaneo completo.
      const SIN_TILDES = (col: string) =>
        Prisma.raw(
          `translate(upper(coalesce(${col},'')), ` +
            `'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö','AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO')`,
        );
      // El término se normaliza IGUAL que las columnas: mismas tildes, mismas
      // letras planas y en mayúsculas. Si no, "josé" no encontraría "JOSE".
      const patron = `%${quitarTildes(searchTerm)}%`;

      // UNION, no un OR gigante. Con OR sobre columnas de TABLAS DISTINTAS Postgres
      // tiene que unir las tres tablas enteras y filtrar después: 679 ms medidos y
      // ni un índice usado. Separado en ramas, cada una busca en SU tabla con SU
      // índice y luego se juntan los ids.
      const matches = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM (
          SELECT o.id FROM "Order" o
            WHERE ${SIN_TILDES('o.folio')} LIKE ${patron}
          UNION
          SELECT o.id FROM "Order" o
            WHERE ${SIN_TILDES('o.encargado')} LIKE ${patron}
          UNION
          SELECT o.id FROM "Order" o JOIN "Client" c ON c.id = o."clientId"
            WHERE ${SIN_TILDES('c.nombre')} LIKE ${patron}
          UNION
          SELECT o.id FROM "Order" o JOIN "Client" c ON c.id = o."clientId"
            WHERE ${SIN_TILDES('c."parrandaId"')} LIKE ${patron}
          UNION
          SELECT o.id FROM "Order" o JOIN "Seller" s ON s.id = o."sellerId"
            WHERE ${SIN_TILDES('s.name')} LIKE ${patron}
          UNION
          -- Por PRODUCTO y por su código. Es la pregunta que más se hace cuando
          -- falta mercancía: "¿quién pidió cerveza?" o "¿qué pedidos llevan el
          -- 10234?". Sin esto había que abrir los pedidos de uno en uno.
          SELECT i."orderId" AS id FROM "OrderItem" i
            WHERE ${SIN_TILDES('i.producto')} LIKE ${patron}
          UNION
          SELECT i."orderId" AS id FROM "OrderItem" i
            WHERE ${SIN_TILDES('i.code')} LIKE ${patron}
        ) q
        LIMIT 5000`;
      const ids = matches.map((m) => m.id);
      // Si no hay match, forzar 0 resultados (id imposible) en vez de ignorar el filtro.
      conditions.push({ id: { in: ids.length ? ids : ['__no_match__'] } });
    }

    if (producto) {
      conditions.push({ items: { some: { producto } } });
    }

    // Filter by estado
    if (estado) {
      const now = new Date();
      
      switch (estado) {
        case 'completada':
          // Only show orders explicitly marked as completada
          conditions.push({ 
            estado: 'completada'
          });
          break;
        case 'en_proceso':
          // Orders not completed and not expired
          conditions.push({
            OR: [
              { estado: null },
              { estado: { not: 'completada' } }
            ]
          });
          conditions.push({
            OR: [
              { fecha_comprometida: null },
              { fecha_comprometida: { gte: now } },
            ],
          });
          break;
        case 'expirada':
          // Orders not completed but with expired date
          conditions.push({
            OR: [
              { estado: null },
              { estado: { not: 'completada' } }
            ]
          });
          conditions.push({
            AND: [
              { fecha_comprometida: { not: null } },
              { fecha_comprometida: { lt: now } }
            ]
          });
          break;
      }
    }

    // Filtro por rango de fechas (campo 'fecha').
    //
    // Las dos se COMPRUEBAN antes de usarlas. Antes se hacía
    // `new Date(fechaDesde + 'T00:00:00.000Z')` a pelo, y una fecha ilegible
    // daba `Invalid Date`: Prisma rechaza la consulta entera y la lista sale en
    // blanco, sin decir por qué. Pasó el 06/08/2026 — el campo de fecha del
    // navegador deja teclear un año de más de cuatro cifras ("202026-08-06").
    if (fechaDesde || fechaHasta) {
      const desde = parsearFechaConsulta(fechaDesde, 'fechaDesde');
      const hasta = parsearFechaConsulta(fechaHasta, 'fechaHasta', true);

      // Se avisa en vez de ignorar la fecha en silencio: si se ignorara, se
      // devolverían pedidos de fuera del rango pedido y parecerían del rango.
      if (desde.error || hasta.error) {
        return res.status(400).json({ error: desde.error || hasta.error });
      }

      const dateFilter: any = {};
      if (desde.fecha) dateFilter.gte = desde.fecha;
      if (hasta.fecha) dateFilter.lte = hasta.fecha;
      if (Object.keys(dateFilter).length) conditions.push({ fecha: dateFilter });
    }

    // Filter por "vendedor" = usuario/gestor vinculado (desde el desplegable, sin teclear
    // el nombre). Filtra los pedidos cuyos vendedores gestiona ese usuario.
    if (usuarioId) {
      conditions.push({ vendedor: { gestorId: usuarioId } });
    }

    // Filter by domicilio (para ver los pedidos con envío a domicilio y su costo)
    if (domicilio) {
      switch (domicilio) {
        case 'calculado':
          // Ya tiene un costo de domicilio calculado
          conditions.push({ costoDomicilio: { not: null } });
          break;
        case 'pendiente':
          // Requiere domicilio pero el worker aún no lo calcula (falta geo del cliente)
          conditions.push({ requiere_domicilio: true });
          conditions.push({ costoDomicilio: null });
          break;
        case 'requiere':
          // Todos los que llevan domicilio (calculado o no)
          conditions.push({ requiere_domicilio: true });
          break;
        case 'sin':
          // No llevan domicilio
          conditions.push({
            OR: [
              { requiere_domicilio: false },
              { requiere_domicilio: null },
            ],
          });
          break;
      }
    }

    // Combine all conditions with AND
    if (conditions.length > 0) {
      where.AND = conditions;
    }

    // Get total count for pagination
    const total = await prisma.pedido.count({ where });

    // Get paginated orders
    const orders = await prisma.pedido.findMany({
      where,
      include: { 
        items: true, 
        cliente: true, 
        vendedor: true 
      },
      orderBy: { fecha: 'desc' },
      skip,
      take: limit,
    });

    // Calculate dynamic estado only for display (not for filtering)
    // El precio y el total, en la MISMA respuesta que la lista.
    //
    // Se resuelve aquí y no en el navegador porque el precio depende de la sucursal
    // del pedido: hacerlo en el front obligaría a bajarse el catálogo entero de las
    // diez sucursales para pintar una página de veinte pedidos.
    const conTotales = await Promise.all(orders.map((o) => conPrecios(o)));

    const ordersWithStatus = conTotales.map(order => {
      let computedEstado = order.estado;
      
      // If estado is null or not completada, calculate based on dates
      if (!computedEstado || computedEstado !== 'completada') {
        if (order.fecha_comprometida && new Date(order.fecha_comprometida) < new Date()) {
          computedEstado = 'expirada';
        } else {
          computedEstado = 'en_proceso';
        }
      }

      return {
        ...order,
        estado: computedEstado,
      };
    });

    res.json({
      data: ordersWithStatus,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// SSE: transmite los pedidos NUEVOS en tiempo real (aparecen en la lista sin
// refrescar). Mismo scoping que GET / (requireSucursalId lee ?sucursalId= o token).
// EventSource no manda headers, por eso el front pasa ?sucursalId= y ?token=.
// Emite un TICKET efímero de un solo uso para abrir un SSE. EventSource no manda
// headers, así que en vez de poner el token en la URL, el front pide este ticket con su
// Bearer normal (header) y abre el stream con ?ticket=. El ticket dura ~30s y lleva el
// scope ya resuelto; se quema al usarse.
/**
 * GET /productos — los productos que aparecen en los pedidos de esta sucursal.
 *
 * Es lo que llena el selector del filtro. Se sacan de las líneas reales y no de un
 * catálogo aparte: así la lista es exactamente lo que se puede encontrar filtrando, y
 * no hay opciones que no devuelvan nada ni productos que existan y no estén.
 *
 * Va por sucursal porque el filtro también: enseñar los de otra sería ofrecer una
 * búsqueda que siempre sale vacía.
 */
router.get('/productos', async (req, res) => {
  try {
    const { sucursalId, error } = resolveSucursalFilter(req);
    if (error) return res.status(400).json({ error });

    const filas = await prisma.pedidoItem.findMany({
      where: { pedido: { sucursalId } },
      select: { producto: true },
      distinct: ['producto'],
      orderBy: { producto: 'asc' },
    });

    res.json(filas.map((f) => f.producto).filter(Boolean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list productos' });
  }
});

router.post('/sse-ticket', async (req, res) => {
  const { sucursalId, error } = resolveSucursalFilter(req);
  if (error) return res.status(400).json({ error });
  const ticket = await mintSseTicket({ sucursalId: sucursalId ?? null });
  return res.json({ ticket });
});

// El SSE de pedidos vive en /events/stream (canal único de toda la app). Aquí había
// un SEGUNDO stream propio, /orders/stream, que en producción NO servía para nada: se
// suscribía al canal Redis `orders:new` y ese canal no lo publicaba NADIE, así que la
// lista tenía una conexión permanentemente abierta que jamás recibía un pedido (y el
// indicador "en vivo" salía verde igual). Ahora el pedido completo viaja por el canal
// único, con lo que además se ahorra una conexión por pestaña.

// Create a new order (basic)
router.post('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError, status: sucursalStatus } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(sucursalStatus ?? 400).json({ error: sucursalError });
    }

    const { folio, sellerId, clientId, direccion, encargado, telefono, fecha, fecha_comprometida, items } = req.body;

    const order = await prisma.pedido.create({
      data: {
        folio: folio?.toUpperCase() || '',
        sucursalId,
        vendedorId: sellerId || null,
        clienteId: clientId || null,
        direccion: direccion || null,
        encargado: encargado?.toUpperCase() || null,
        telefono: telefono || null,
        fecha: fecha ? new Date(fecha) : new Date(),
        fecha_comprometida: fecha_comprometida ? new Date(fecha_comprometida) : null,
        estado: 'en_proceso',
        items: {
          create: (items || []).map((it: any) => ({
            producto: it.producto?.toUpperCase() || '',
            unidades: Number(it.unidades || 0),
            packs: it.packs != null ? Number(it.packs) : null,
            descripcion: it.descripcion || null,
          })),
        },
      },
      include: { items: true }
    });

    // Si hay que llevarlo a casa, la APK tiene que cotizarlo. Va por la cola: el aviso
    // no puede hacer esperar a quien está creando el pedido, ni fallar si la APK está
    // caída.
    // Antes aquí se avisaba a Entrega del pedido nuevo. Ya no hace falta: el
    // repartidor teclea el folio allí y el cliente lo tiene sincronizado.
    // El pedido viaja COMPLETO (misma forma que la lista) para que las vistas lo
    // inserten arriba sin volver a pedir la página entera.
    emitEvent('pedido', {
      sucursalId: order.sucursalId,
      id: order.id,
      accion: 'create',
      datos: await pedidoParaLista(order.id),
    });

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/**
 * El `where` para trabajar sobre UN pedido, con el mismo alcance que la lista.
 *
 * Existe por un fallo real: la lista usa `resolveSucursalFilter`, que al Super
 * Admin le devuelve TODAS las sucursales, mientras que completar y borrar usaban
 * `requireSucursalId`, que EXIGE una sucursal concreta. El Super Admin no tiene
 * sucursal propia, asi que veia todos los pedidos y no podia completar ninguno:
 * "Error al completar el pedido", sin mas. Y solo le pasaba a el, por eso parecia
 * que a unos usuarios les dejaba y a otros no.
 *
 * Leer y escribir tienen que alcanzar LO MISMO. Si se puede ver, se puede tocar;
 * y si no se puede tocar, no se deberia poder ver.
 *
 * Devuelve `where` para buscar el pedido, o `error` con el mensaje ya listo.
 */
function alcancePedido(req: Request): { where?: { id: string; sucursalId?: string }; error?: string } {
  const id = String(req.params.id);
  const { sucursalId, isGlobalAdmin, error } = resolveSucursalScope(req, {
    allowAllForAdmin: true,
    preferUserSucursal: true,
    defaultAllForAdmin: true,
  });

  if (error) return { error };

  // El Super Admin sin sucursal enfocada llega a cualquier pedido, igual que los
  // ve todos en la lista. Los demas, solo a los de la suya.
  if (!sucursalId) {
    if (isGlobalAdmin) return { where: { id } };

    return {
      error:
        'No hay sucursal disponible para esta solicitud. Inicia sesion con un usuario asignado a sucursal.',
    };
  }

  return { where: { id, sucursalId } };
}

// Update order status to completada
router.patch('/:id/completar', async (req, res) => {
  try {
    const { id } = req.params;

    // El GESTOR ve sus pedidos y no los cierra. Completar es decir "esto ya se
    // facturo", y eso lo dice quien factura (Operador) o quien manda en la
    // sucursal. La pantalla ya no le ensena el boton; esta comprobacion es la
    // que de verdad lo impide.
    if (!getRequesterContext(req).puedeCompletarPedidos) {
      return res.status(403).json({
        error: 'Tu rol no puede completar pedidos. Los completa el Operador o quien lleva la sucursal.',
      });
    }

    const { where, error: sucursalError } = alcancePedido(req);
    if (sucursalError || !where) {
      return res.status(400).json({ error: sucursalError });
    }

    const existingOrder = await prisma.pedido.findFirst({
      where,
      select: { id: true },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // Al completar se marca la fecha de completado; NO se archiva de inmediato. El
    // archivado (soft-delete) ocurre una semana DESPUÉS, en el job de archivado.
    const order = await prisma.pedido.update({
      where: { id },
      data: { estado: 'completada', completedAt: new Date() },
      include: { items: true, cliente: true, vendedor: true, sucursal: { select: { codigo: true } } },
    });

    // Webhook PUSH (configurable): avisa a Parranda que el pedido se completó + la fecha.
    notifyPedidoCompletado(order);
    emitEvent('pedido', {
      sucursalId: order.sucursalId,
      id: order.id,
      accion: 'update',
      // pedidoParaLista y no `order` a secas: hace falta pasar por conPrecios, o esta
      // actualización pisa la fila de la lista con una versión sin precios ni total.
      datos: await pedidoParaLista(order.id),
    });

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Borrar un pedido: Super Admin, Administrador o Supervisor.
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Esto NO se comprobaba. La lista escondia el boton a los demas roles, pero
    // el endpoint aceptaba el DELETE de cualquiera con sesion: un Gestor o un
    // Operador podian borrar un pedido llamando a la API a mano.
    if (!getRequesterContext(req).puedeBorrarPedidos) {
      return res.status(403).json({
        error: 'Tu rol no puede borrar pedidos.',
      });
    }

    const { where, error: sucursalError } = alcancePedido(req);
    if (sucursalError || !where) {
      return res.status(400).json({ error: sucursalError });
    }

    // Check if order exists
    const existingOrder = await prisma.pedido.findFirst({
      where,
      include: { items: true },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // Delete order items first (cascade might not be set up)
    await prisma.pedidoItem.deleteMany({
      where: { pedidoId: id },
    });

    // Delete the order
    await prisma.pedido.delete({
      where: { id },
    });
    emitEvent('pedido', { sucursalId: existingOrder.sucursalId, id, accion: 'delete' });

    res.json({ success: true, message: 'Pedido eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el pedido' });
  }
});

// Resuelve el vendedor del CSV SIN saber la sucursal: se busca por `codigo`
// (único global, ej. "andy.almanza"). La sucursal se deriva del gestor.
//   - no existe        -> se crea sin gestor  => "Sin asignar" (pedidos ocultos)
//   - existe, mismo    -> se reutiliza        => sucursal = gestor.sucursalId
//   - existe, OTRO nombre -> colisión: es otra persona con el mismo código.
type SellerResolution = { seller: { id: string }; sucursalId: string | null };

class VendedorColisionError extends Error {
  constructor(codigo: string, existente: string, entrante: string) {
    super(
      `Colisión de vendedor: el código '${codigo}' ya pertenece a '${existente}', ` +
        `pero el archivo trae '${entrante}'. Son personas distintas: el archivo no se importó.`,
    );
    this.name = 'VendedorColisionError';
  }
}

class VendedorInactivoError extends Error {
  constructor(nombre: string) {
    super(
      `El vendedor '${nombre}' está dado de baja: no se aceptan sus pedidos. ` +
        `Si volvió, reactívalo desde la vista de Gestores.`,
    );
    this.name = 'VendedorInactivoError';
  }
}

// La sucursal la decide el GESTOR del vendedor. Quién sube el CSV ya no influye:
// un vendedor sin gestor entra "Sin asignar", sin sucursal.
async function resolveSeller(name: string, code: string): Promise<SellerResolution> {
  // Nombre y codigo se aplanan con `lib/nombreVendedor`, que es EL MISMO modulo
  // que usa el alta manual desde la aplicacion. Antes estaba aqui suelto, y una
  // copia es justo lo que no puede haber: si los dos caminos aplanaran distinto,
  // un vendedor dado de alta a mano no lo encontraria este archivo y se crearia
  // una SEGUNDA ficha, con sus pedidos partidos entre las dos.
  const nombre = nombreComparable(name);
  const codigo = codigoComparable(code);

  // 1) Por código (clave nueva). 2) Si no aparece, POR NOMBRE: así seguimos
  //    encontrando a los vendedores creados con la regla de código vieja
  //    ("glenda.melisa") y les corregimos el código al vuelo, sin duplicarlos.
  let existing = codigo
    ? await prisma.vendedor.findUnique({ where: { codigo }, include: { gestor: true } })
    : null;

  if (!existing) {
    // Se busca con el nombre YA NORMALIZADO y sin distinguir mayusculas. Antes se
    // buscaba con el `name` crudo aunque justo arriba se calculaba `nombre`: un
    // CSV con la caja distinta no encontraba al vendedor y creaba un DUPLICADO,
    // con sus pedidos repartidos entre los dos.
    // Se busca con el nombre YA PLANO. La base guarda los nombres planos desde
    // el 06/08/2026 (se limpiaron los que habia), asi que los dos lados coinciden.
    const porNombre = await prisma.vendedor.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' } },
      include: { gestor: true },
    });
    if (porNombre) {
      if (!porNombre.activo) throw new VendedorInactivoError(porNombre.nombre);
      if (codigo && porNombre.codigo !== codigo) {
        try {
          existing = await prisma.vendedor.update({
            where: { id: porNombre.id },
            data: { codigo },
            include: { gestor: true },
          });
        } catch (e) {
          // El código nuevo ya lo tiene OTRA persona -> colisión real.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const dueno = await prisma.vendedor.findUnique({ where: { codigo } });
            throw new VendedorColisionError(codigo, dueno?.nombre ?? '(otro)', name);
          }
          throw e;
        }
      } else {
        existing = porNombre;
      }
    }
  }

  if (existing) {
    // Los DOS lados con la misma vara. Antes se normalizaba solo el que venia
    // del archivo y se comparaba contra el guardado en crudo: cualquier
    // diferencia invisible entre ambos se leia como "son personas distintas" y
    // el archivo entero se rechazaba.
    if (nombreComparable(existing.nombre) !== nombre) {
      throw new VendedorColisionError(code, existing.nombre, name);
    }
    // Vendedor dado de baja: su CSV ya no debería llegar; si llega, se rechaza.
    if (!existing.activo) {
      throw new VendedorInactivoError(existing.nombre);
    }
    // La sucursal sale del GESTOR y de nadie más. Antes caía en cascada al que
    // subía el CSV, y eso metía a un vendedor "Sin asignar" dentro de la sucursal
    // del que le tocara importar ese día: así 'glenda.melisa' acabó fichada en GTO
    // con sus 1447 pedidos en STG. Sin gestor => sin sucursal => "Sin asignar".
    const sucursalId = existing.gestor?.sucursalId ?? null;

    // La ficha del vendedor sigue al gestor. Si estaba en otra sucursal (heredada
    // del uploader o de una restauración), se corrige aquí en vez de quedar torcida.
    if (existing.sucursalId !== sucursalId) {
      await prisma.vendedor.update({ where: { id: existing.id }, data: { sucursalId } });
    }
    return { seller: existing, sucursalId };
  }

  // Vendedor nuevo: SIN sucursal y SIN gestor. Sus pedidos entran pero quedan
  // ocultos hasta que se le enlace un gestor desde la vista de Vendedores; ese
  // enlace los reparte a la sucursal correcta.
  const seller = await prisma.vendedor.create({
    // Se guarda el nombre PLANO (`nombre`), no el crudo del archivo. Si se
    // guardara crudo, el siguiente archivo que trajera la tilde escrita de la
    // otra forma no lo encontraria y lo daria por otra persona.
    data: { nombre, codigo: codigo || null, sucursalId: null, gestorId: null },
  });
  return { seller, sucursalId: null };
}

// Bulk create orders from CSV records
/**
 * PATCH /:id/estado — mover un pedido entre "en proceso" y "completado".
 *
 * Completar ya se podía; lo que no se podía era DESHACERLO. Y completar es un clic
 * en una lista larga: se hace sin querer, o se completa el de arriba creyendo que era
 * el de abajo. Sin vuelta atrás, el arreglo era pedirle a alguien que lo tocara en la
 * base de datos.
 *
 * "Expirado" no se pone a mano y por eso no se acepta aquí: sale de la fecha
 * comprometida, así que ponerlo sería mentir sobre una fecha que está ahí al lado.
 *
 * Al reabrir se limpia también el archivado. Un pedido completado se archiva a la
 * semana; si se reabre uno ya archivado y no se desarchiva, vuelve a la lista... y no
 * aparece, porque la lista esconde lo archivado. Estaría reabierto e invisible.
 */
router.patch('/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body as { estado?: string };

    if (estado !== 'completada' && estado !== 'en_proceso') {
      return res.status(400).json({
        error: 'El estado solo puede ser "completada" o "en_proceso". El expirado sale de la fecha comprometida.',
      });
    }

    // Mismo permiso que completar: reabrir es tan delicado como cerrar, y quien no
    // puede una cosa no tiene por qué poder la otra.
    if (!getRequesterContext(req).puedeCompletarPedidos) {
      return res.status(403).json({
        error: 'Tu rol no puede cambiar el estado de los pedidos. Lo hace el Operador o quien lleva la sucursal.',
      });
    }

    const { where, error: sucursalError } = alcancePedido(req);
    if (sucursalError || !where) {
      return res.status(400).json({ error: sucursalError });
    }

    const existente = await prisma.pedido.findFirst({
      where,
      select: { id: true, fecha_comprometida: true },
    });
    if (!existente) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // Un pedido EXPIRADO no lo está por un campo: lo está porque su fecha comprometida
    // ya pasó. Devolverlo a "en proceso" sin tocar esa fecha no haría nada — se
    // volvería a calcular expirado en la siguiente carga y parecería que el botón está
    // roto. Así que se le quita el plazo vencido.
    //
    // Se avisa antes de pulsar, en la ventana de confirmación: enterarse después de
    // que desapareció una fecha es peor que el problema que venía a resolver.
    const vencido =
      existente.fecha_comprometida != null &&
      new Date(existente.fecha_comprometida) < new Date();

    const order = await prisma.pedido.update({
      where: { id },
      data:
        estado === 'completada'
          ? { estado: 'completada', completedAt: new Date() }
          : {
              estado: null,
              completedAt: null,
              archivedAt: null,
              ...(vencido ? { fecha_comprometida: null } : {}),
            },
      include: { items: true, cliente: true, vendedor: true, sucursal: { select: { codigo: true } } },
    });

    // A Parranda se le avisa solo al completar: es lo que su webhook entiende.
    if (estado === 'completada') notifyPedidoCompletado(order);

    // Un pedido que se REABRE y sigue pidiendo domicilio sin costo hay que volver a
    // cotizarlo, y en el acto. Si no, se queda esperando a que alguien importe un CSV o
    // pulse "Reencolar" —o sea, a que alguien se acuerde—, que es justo lo que no puede
    // pasar con un pedido que acaba de volver a estar activo.
    if (estado !== 'completada' && order.requiere_domicilio && order.costoDomicilio == null) {
    // Antes aquí se avisaba a Entrega del pedido nuevo. Ya no hace falta: el
    // repartidor teclea el folio allí y el cliente lo tiene sincronizado.
    }

    emitEvent('pedido', {
      sucursalId: order.sucursalId,
      id: order.id,
      accion: 'update',
      // pedidoParaLista y no `order` a secas: hace falta pasar por conPrecios, o esta
      // actualización pisa la fila de la lista con una versión sin precios ni total.
      datos: await pedidoParaLista(order.id),
    });

    res.json({ ...order, estado: computeEstado(order) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

router.post('/bulk', ingestaAuth, async (req, res) => {
  try {
    // El Operador no sube datos: factura con lo que ya está. La ingesta
    // automática (por API-key) sí, y por eso la comprobación mira el rol y no
    // "estar autenticado".
    if (!getRequesterContext(req).puedeImportarYReportar) {
      return res.status(403).json({ error: 'Tu usuario no puede importar pedidos.' });
    }

    const { records } = req.body;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid records data' });
    }

    // Sucursal del que sube: es la que se ha usado siempre. Ya no es obligatoria
    // (puede subir cualquiera), pero si la hay manda como antes.
    const { sucursalId: uploaderSucursalId, error: scopeError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (scopeError) return res.status(403).json({ error: scopeError });

    // ENCOLAR y responder al toque (202) SOLO si se optó explícitamente con
    // IMPORT_USE_QUEUE=true (y hay Redis). Requiere que el worker (node dist/worker.js)
    // esté corriendo, si no los jobs no se procesarían. Sin el flag se procesa INLINE
    // (idéntico al comportamiento actual), aunque Redis esté activo para el SSE. Así
    // activar Redis para el pub/sub NO cambia el import por accidente.
    // El ingester (n8n) pide ?sync=1 para procesar INLINE y recibir el resultado real
    // (200 con {created,updated,failed,sinAsignar} o 409 de colisión) en la MISMA
    // respuesta: así mueve el archivo a Procesados/Errores según corrió de verdad, y el
    // log de n8n muestra qué entró y qué falló. La UI (super admin, archivos grandes)
    // sigue con cola+SSE (sin el flag): 202 + progreso por evento.
    // El GESTOR solo importa pedidos de SUS vendedores. Admin/Supervisor/Super Admin
    // importan sin esa restricción (scopeados por sucursal como siempre).
    const gestorCtx = getRequesterContext(req);
    const restrictToGestorId = gestorCtx.isGestor ? (gestorCtx.userId ?? null) : null;

    const forceInline = req.query.sync === '1' || req.query.sync === 'true';
    const queue = (!forceInline && process.env.IMPORT_USE_QUEUE === 'true') ? importQueue() : null;
    if (queue) {
      const job = await queue.add({ records, uploaderSucursalId: uploaderSucursalId ?? null, restrictToGestorId });
      return res.status(202).json({ enqueued: true, jobId: String(job.id) });
    }

    const outcome = await processBulkImport(records, uploaderSucursalId ?? null, restrictToGestorId);
    if (!outcome.ok) return res.status(409).json({ error: outcome.error, imported: 0 });
    return res.json({ success: true, results: outcome.results });
  } catch (err) {
    console.error('Bulk create error:', err);
    res.status(500).json({ error: 'Failed to create orders' });
  }
});

// SSE de la cola de importación: reenvía al front los eventos 'done'/'failed' que el
// worker publica en Redis por cada job. El front abre esto cuando /bulk devolvió 202
// (IMPORT_USE_QUEUE=true) y espera el evento de SU jobId. Sin Redis no hay 202, así que
// no se usa. (Nada de polling: es push por pub/sub, igual que /orders/stream.)
// Estado de un job de importacion, para PREGUNTAR en vez de esperar a ciegas.
//
// El SSE es el camino rapido, pero un stream se puede caer a mitad (un microcorte,
// un proxy que corta la conexion) y entonces el aviso de "listo" no llega nunca. Sin
// esto, la pantalla solo podia esperar a que venciera su tope y decir "tiempo
// agotado" — aunque la importacion hubiera terminado BIEN hace rato, que es lo peor
// que puede pasar: el usuario la repite y duplica trabajo.
//
// Se scopea por sucursal igual que el stream: los conteos de una sucursal no se
// devuelven a otra.
router.get('/import-status/:jobId', async (req, res) => {
  const { sucursalId, error } = resolveSucursalFilter(req);
  if (error) return res.status(400).json({ error });

  // Comprobacion CERRADA: solo el admin global puede mirar sin sucursal. Escrito
  // con un `if (sucursalId && ...)` mas abajo, la comprobacion se saltaba sola en
  // cuanto sucursalId venia vacio — y "vacio" no siempre significa "es admin":
  // basta un camino que no la resuelva para que cualquiera vea los conteos de
  // todas las sucursales. Que falle cerrado y no abierto.
  const { isGlobalAdmin } = getRequesterContext(req);
  if (!sucursalId && !isGlobalAdmin) {
    return res.status(403).json({ error: 'Sin permiso para consultar este trabajo.' });
  }

  const q = importQueue();
  if (!q) return res.status(503).json({ error: 'La cola de importación no está activa' });

  const job = await q.getJob(String(req.params.jobId));
  if (!job) {
    // Bull borra los jobs viejos (removeOnComplete). Que no aparezca NO es un fallo:
    // lo mas probable es que terminara bien hace tiempo. Se dice tal cual en vez de
    // inventar un estado.
    return res.json({ estado: 'desconocido', nota: 'El trabajo ya no está en la cola (suele significar que terminó).' });
  }

  const suyo = (job.data as { uploaderSucursalId?: string | null } | undefined)?.uploaderSucursalId ?? null;
  // 404 y no 403: quien no puede verlo tampoco debe enterarse de que existe.
  if (!isGlobalAdmin && suyo !== sucursalId) {
    return res.status(404).json({ error: 'Trabajo no encontrado' });
  }

  const estado = await job.getState();
  return res.json({
    estado,                                   // completed | failed | active | waiting | delayed
    resultado: estado === 'completed' ? job.returnvalue : undefined,
    error: estado === 'failed' ? job.failedReason : undefined,
  });
});

router.get('/import-stream', async (req, res) => {
  // Auth por TICKET efímero (no token en la URL). El ticket lleva el scope de sucursal
  // ya resuelto, y abajo se filtran los eventos por esa sucursal: sin esto, cualquier
  // cliente recibiría los eventos (jobId, conteos, errores) de TODAS -> fuga cross-tenant.
  const ticket = await consumeSseTicket(req.query.ticket as string | undefined);
  if (!ticket) return res.status(401).json({ error: 'Ticket inválido o expirado' });
  const sucursalId = ticket.sucursalId ?? undefined;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('ready', {});
  const keepAlive = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 120000);

  if (!redisEnabled()) {
    // Sin Redis no hay cola ni eventos (el front no debería abrir esto).
    req.on('close', () => { closed = true; clearInterval(keepAlive); });
    return;
  }

  const sub = getSubscriber()!;
  await sub.subscribe(CH_IMPORT_DONE, CH_IMPORT_FAILED);
  const onMessage = (channel: string, message: string) => {
    if (closed) return;
    try {
      const data = JSON.parse(message);
      // Solo los eventos de la sucursal del que escucha (el Super Admin sin sucursal
      // ve todos). Cada quién solo se entera de SUS importaciones.
      if (sucursalId && data?.uploaderSucursalId !== sucursalId) return;
      if (channel === CH_IMPORT_DONE) send('done', data);
      else if (channel === CH_IMPORT_FAILED) send('failed', data);
    } catch { /* mensaje inválido: ignora */ }
  };
  sub.on('message', onMessage);
  req.on('close', () => {
    closed = true;
    clearInterval(keepAlive);
    sub.off('message', onMessage); // NO unsubscribe: otros clientes siguen escuchando
  });
});

export type BulkImportResults = {
  created: number; updated: number; failed: number; sinAsignar: number; errors: any[];
};
export type BulkImportOutcome = {
  ok: boolean;
  results?: BulkImportResults;
  error?: string; // presente solo si ok === false (colisión de vendedor)
};

// Núcleo de la importación masiva, compartido por el endpoint (fallback inline) y el
// WORKER (cola Redis). Resuelve los vendedores (rechaza el archivo entero si hay
// colisión) y procesa cada registro. No usa `res`, para poder correr fuera del request.
export async function processBulkImport(
  records: any[],
  uploaderSucursalId: string | null,
  // Cuando lo sube un GESTOR: su usuario.id. Solo podrá importar pedidos de SUS
  // vendedores (vendedor.gestorId === este id). null = sin restricción (admin/superv).
  restrictToGestorId: string | null = null,
): Promise<BulkImportOutcome> {
  const mappedRecords = mapCsvRecords(records);

  // Resolvemos TODOS los vendedores antes de importar: si alguno colisiona, se rechaza
  // el archivo completo (misma regla que siempre).
  const sellersByCode = new Map<string, SellerResolution>();
  try {
    for (const r of mappedRecords) {
      const key = r.seller.code || r.seller.name.toUpperCase().trim();
      if (!sellersByCode.has(key)) {
        sellersByCode.set(key, await resolveSeller(r.seller.name, r.seller.code));
      }
    }
  } catch (error) {
    if (error instanceof VendedorColisionError || error instanceof VendedorInactivoError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  // Scoping del GESTOR: solo puede importar pedidos de SUS vendedores. Si el archivo
  // trae vendedores que no gestiona (o desconocidos), se rechaza COMPLETO — no puede
  // subir los pedidos de otro.
  if (restrictToGestorId) {
    const sellerIds = [...new Set([...sellersByCode.values()].map((s) => s.seller.id))];
    const vendedores = await prisma.vendedor.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, codigo: true, nombre: true, gestorId: true },
    });
    const ajenos = vendedores.filter((v) => v.gestorId !== restrictToGestorId);
    if (ajenos.length) {
      const cods = [...new Set(ajenos.map((v) => v.codigo || v.nombre))].slice(0, 15).join(', ');

      return {
        ok: false,
        error: `Solo puedes importar pedidos de TUS vendedores. El archivo trae vendedores que no gestionas: ${cods}.`,
      };
    }
  }

  const results: BulkImportResults = { created: 0, updated: 0, failed: 0, sinAsignar: 0, errors: [] };
  for (const record of mappedRecords) {
    const key = record.seller.code || record.seller.name.toUpperCase().trim();
    const resolved = sellersByCode.get(key)!;
    try {
      await processOrderRecord(record, results, resolved.seller.id, resolved.sucursalId);
      if (resolved.sucursalId === null) results.sinAsignar++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        record: record.order.folio,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      console.error('Error processing record:', error);
    }
  }

  // Se importaron pedidos: los que pidan domicilio entran en la cola de cotización.
  if (results.created > 0 || results.updated > 0) {
    emitEvent('pedido', { sucursalId: uploaderSucursalId ?? null, accion: 'bulk' });
    emitEvent('cliente', { sucursalId: uploaderSucursalId ?? null, accion: 'bulk' });
  }
  return { ok: true, results };
}

// `sellerId` viene ya resuelto (global por código) y `sucursalId` sale de su gestor.
// sucursalId = null  =>  "Sin asignar": el pedido entra pero queda oculto en la
// vista de pedidos (que scopea por sucursal) hasta que se enlace el vendedor.
async function processOrderRecord(
  record: OrderRecordDto,
  results: any,
  sellerId: string,
  sucursalId: string | null,
) {
  const seller = { id: sellerId };

  // Keep client matching by name only (NOT by codigo), to avoid cross-vendor
  // collisions when CSVs contain repeated client codes.
  //
  // El nombre se guarda SIEMPRE en mayúsculas, que es como se busca: si se guardara
  // crudo, la búsqueda no encontraría al cliente y lo duplicaría.
  // El nombre del cliente, PLANO — igual que el del vendedor y con la misma
  // funcion. Antes solo se pasaba a mayusculas: un cliente cuyo nombre llegara
  // con la tilde escrita de la otra forma no se encontraba y se creaba OTRA
  // ficha del mismo negocio. Asi aparecieron cientos de duplicados (335 el
  // 05/08 y 65 mas el 06/08, todos fusionados). El indice unico es
  // (nombre, sucursalId), asi que guardarlo plano es lo que hace que el
  // get-or-create encuentre al que ya esta.
  const nombreCliente = nombreComparable(record.client.nombre);
  const incomingCode = record.client.codigo?.toString().trim() || null;

  const actualizarCliente = (existente: { id: string; codigo: string | null }) => {
    const canUpdateCode =
      !!incomingCode &&
      (!existente.codigo || existente.codigo.trim() === '' || existente.codigo === incomingCode);

    return prisma.cliente.update({
      where: { id: existente.id },
      data: {
        nombre: nombreCliente,
        zona: record.client.zona,
        sucursalId,
        codigo: canUpdateCode ? incomingCode : existente.codigo,
      },
    });
  };

  // Get-or-create a prueba de carreras. Cuando un lote trae varios pedidos del mismo
  // cliente, todos llegan a la vez y todos ven "no existe"; el índice único
  // (nombre, sucursalId) hace que solo uno lo cree y los demás fallen con P2002.
  // Ese P2002 NO es un error: significa que otro lo creó primero, así que se relee.
  // Sin esto el cliente se duplicaba y el pedido salía con folio -1, -2, -3...
  let client;
  const existingClient = await prisma.cliente.findFirst({
    where: { nombre: nombreCliente, sucursalId },
  });

  if (existingClient) {
    client = await actualizarCliente(existingClient);
  } else {
    try {
      client = await prisma.cliente.create({
        data: {
          codigo: incomingCode,
          nombre: nombreCliente,
          zona: record.client.zona,
          sucursalId,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      // Perdimos la carrera contra otro pedido del mismo lote: el cliente ya existe.
      const ganador = await prisma.cliente.findFirst({
        where: { nombre: nombreCliente, sucursalId },
      });

      if (ganador) {
        client = await actualizarCliente(ganador);
      } else {
        // No fue el nombre: el choque vino del codigo repetido en el CSV de origen
        // (unico por sucursal+codigo). Se crea sin codigo para no tumbar la importación.
        client = await prisma.cliente.create({
          data: {
            nombre: nombreCliente,
            zona: record.client.zona,
            sucursalId,
          },
        });
      }
    }
  }

  // Extract base folio (remove only small suffixes like -1, -2, NOT the folio number like -1130)
  // Only match suffixes of 1-2 digits at the very end (our generated suffixes)
  const baseFolioMatch = record.order.folio.match(/^(.+)-(\d{1,2})$/);
  const baseFolio = baseFolioMatch ? baseFolioMatch[1] : record.order.folio;

  // Check if order already exists for THIS client (with base folio or any suffix)
  const existingOrder = await prisma.pedido.findFirst({
    where: {
      sucursalId,
      OR: [
        { folio: baseFolio },
        { folio: { startsWith: `${baseFolio}-` } },
      ],
      vendedorId: seller.id,
      clienteId: client.id,
    },
    include: {
      items: true,
    },
  });

  // Generate unique folio if no existing order for this client
  let finalFolio = baseFolio;
  if (!existingOrder) {
    // Find ALL existing folios with this base pattern in the database
    const existingFolios = await prisma.pedido.findMany({
      where: {
        sucursalId,
        OR: [
          { folio: baseFolio },
          { folio: { startsWith: `${baseFolio}-` } },
        ],
      },
      select: { folio: true, clienteId: true },
    });
    
    // Check if base folio is taken by another client
    const baseFolioTaken = existingFolios.some(o => o.folio === baseFolio && o.clienteId !== client.id);
    
    if (baseFolioTaken || existingFolios.length > 0) {
      // Find the next available suffix
      let maxSuffix = 0;
      for (const order of existingFolios) {
        if (order.folio === baseFolio) continue;
        const match = order.folio.match(new RegExp(`^${baseFolio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`));
        if (match) {
          const suffix = parseInt(match[1]);
          if (suffix > maxSuffix) maxSuffix = suffix;
        }
      }
      
      // If base folio is taken, we need a suffix
      if (baseFolioTaken) {
        finalFolio = `${baseFolio}-${maxSuffix + 1}`;
      }
    }
  } else {
    // Use the existing folio for this client
    finalFolio = existingOrder.folio;
  }

  if (existingOrder) {
    // Update the order's fecha_comprometida if the new record has a different one
    // Use the latest (most future) fecha_comprometida
    const updateData: any = {};
    if (record.order.fecha_comprometida) {
      const existingFecha = existingOrder.fecha_comprometida;
      const newFecha = record.order.fecha_comprometida;
      if (!existingFecha || newFecha > existingFecha) {
        updateData.fecha_comprometida = newFecha;
      }
    }
    if (record.order.pedido_cobrado !== undefined) {
      updateData.pedido_cobrado = record.order.pedido_cobrado;
    }

    // El costo del domicilio se INVALIDA (vuelve a null) cuando cambia algo que lo determina:
    // que el pedido pase a llevar (o dejar de llevar) domicilio, o que cambien las cantidades
    // (cambia el peso). El worker lo recotiza solo con los datos nuevos; y si ya no lleva
    // domicilio, se queda sin costo. Así un pedido re-subido o editado nunca arrastra un
    // precio viejo que ya no corresponde.
    let invalidarCosto = false;

    if (record.order.requiere_domicilio !== undefined) {
      updateData.requiere_domicilio = record.order.requiere_domicilio;
      if (record.order.requiere_domicilio !== existingOrder.requiere_domicilio) {
        invalidarCosto = true;
      }
    }

    // Check if item already exists in this order
    const existingItem = existingOrder.items.find(
      (item) => item.producto.toUpperCase() === record.item.producto.toUpperCase(),
    );

    if (existingItem) {
      // Only update if quantities are different (replace, don't sum)
      const newUnidades = record.item.unidades;
      const newPacks = record.item.packs || 0;
      const existingPacks = existingItem.packs || 0;

      if (existingItem.unidades !== newUnidades || existingPacks !== newPacks) {
        // Quantities changed - update with new values
        await prisma.pedidoItem.update({
          where: { id: existingItem.id },
          data: {
            unidades: newUnidades,
            packs: newPacks || null,
            descripcion: record.item.descripcion || existingItem.descripcion,
            // Se conserva lo que ya habia si el archivo no lo trae: una celda
            // vacia no debe borrar un dato bueno guardado antes.
            codigo: record.item.codigo ?? existingItem.codigo,
            hl: record.item.hl ?? existingItem.hl,
            precio_linea: record.item.precio_linea ?? existingItem.precio_linea,
          },
        });
        invalidarCosto = true; // cambió el peso del pedido -> hay que recotizar
        results.updated++;
      }
      // If quantities are the same, do nothing (skip)
    } else {
      // Add new item to existing order
      await prisma.pedidoItem.create({
        data: {
          pedidoId: existingOrder.id,
          ...record.item,
        },
      });
      invalidarCosto = true; // producto nuevo -> cambió el peso del pedido
    }

    if (invalidarCosto) {
      updateData.costoDomicilio = null;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.pedido.update({
        where: { id: existingOrder.id },
        data: updateData,
      });
    }

    results.updated++;
  } else {
    // Create new order with item
    await prisma.pedido.create({
      data: {
        folio: finalFolio,
        sucursalId,
        vendedorId: seller.id,
        clienteId: client.id,
        direccion: record.order.direccion,
        encargado: record.order.encargado,
        telefono: record.order.telefono,
        fecha: record.order.fecha,
        fecha_comprometida: record.order.fecha_comprometida,
        estado: 'en_proceso',
        pedido_cobrado: record.order.pedido_cobrado ?? null,
        requiere_domicilio: record.order.requiere_domicilio ?? null,
        items: {
          create: {
            producto: record.item.producto,
            codigo: record.item.codigo ?? null,
            unidades: record.item.unidades,
            packs: record.item.packs,
            descripcion: record.item.descripcion,
            hl: record.item.hl ?? null,
            precio_linea: record.item.precio_linea ?? null,
          },
        },
      },
    });
    results.created++;
  }
}

// Get dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError, status: sucursalStatus } = resolveSucursalFilter(req);
    if (sucursalError) {
      return res.status(sucursalStatus ?? 400).json({ error: sucursalError });
    }

    // El GESTOR ve SOLO sus números (pedidos de SUS vendedores), no los de toda la
    // sucursal. Para admin/supervisor/super admin queda igual (filtro vacío).
    const statsCtx = getRequesterContext(req);
    const gestorFilter =
      statsCtx.isGestor && statsCtx.userId
        ? { vendedor: { gestorId: statsCtx.userId } }
        : {};

    const now = new Date();
    const year = req.query.year ? parseInt(req.query.year as string) : null;

    // Condición de año si se especifica
    const yearCondition = year ? {
      fecha_comprometida: {
        gte: new Date(year, 0, 1), // 1 de enero del año
        lt: new Date(year + 1, 0, 1) // 1 de enero del siguiente año
      }
    } : {};

    // Los cuatro conteos son independientes entre sí: van en PARALELO. En serie
    // sumaban sus cuatro latencias, y este endpoint es el que pinta el panel —
    // o sea, lo primero que ve todo el mundo al entrar.
    //
    // El desglose mensual va aparte, en SQL. Antes se traía a Node TODOS los
    // pedidos de la sucursal (43.000 filas, dos columnas) en cada carga del panel
    // solo para contarlos por mes con un bucle. Ahora lo agrupa Postgres y vuelven
    // ~24 filas.
    const filtroMensual = [
      Prisma.sql`o.fecha_comprometida is not null`,
      sucursalId ? Prisma.sql`o."sucursalId" = ${sucursalId}` : Prisma.sql`true`,
      statsCtx.isGestor && statsCtx.userId
        ? Prisma.sql`exists (select 1 from "Seller" s where s.id = o."sellerId" and s."gestorId" = ${statsCtx.userId})`
        : Prisma.sql`true`,
    ];

    const [totalPedidos, pedidosCompletados, pedidosEnProceso, pedidosExpirados, porMes] =
      await Promise.all([
        // Total de pedidos (del año seleccionado o todos)
        prisma.pedido.count({
          where: { sucursalId, ...gestorFilter, ...yearCondition },
        }),

        // Pedidos completados
        prisma.pedido.count({
          where: { sucursalId, ...gestorFilter, estado: 'completada', ...yearCondition },
        }),

        // Pedidos en proceso (no completados y no expirados)
        prisma.pedido.count({
          where: {
            sucursalId,
            ...gestorFilter,
            OR: [{ estado: null }, { estado: { not: 'completada' } }],
            AND: [
              { OR: [{ fecha_comprometida: null }, { fecha_comprometida: { gte: now } }] },
            ],
            ...yearCondition,
          },
        }),

        // Pedidos expirados (no completados y con fecha vencida)
        prisma.pedido.count({
          where: {
            sucursalId,
            ...gestorFilter,
            OR: [{ estado: null }, { estado: { not: 'completada' } }],
            AND: [{ fecha_comprometida: { lt: now } }],
            ...yearCondition,
          },
        }),

        // Desglose mensual agregado por Postgres. Los count() vuelven como bigint,
        // que JSON.stringify no sabe serializar: se castean a int aquí.
        prisma.$queryRaw<Array<{ year: number; month: number; total: number; completed: number }>>(
          Prisma.sql`
            select extract(year  from o.fecha_comprometida)::int as year,
                   extract(month from o.fecha_comprometida)::int as month,
                   count(*)::int                                  as total,
                   count(*) filter (where o.status = 'completada')::int as completed
              from "Order" o
             where ${Prisma.join(filtroMensual, ' and ')}
             group by 1, 2
             order by 1 desc, 2 asc
          `,
        ),
      ]);

    const monthlyStats = porMes.map((m) => ({
      year: Number(m.year),
      month: Number(m.month),
      total: Number(m.total),
      completed: Number(m.completed),
    }));

    // Años disponibles ordenados descendente
    const availableYears = Array.from(new Set(monthlyStats.map((m) => m.year))).sort(
      (a, b) => b - a,
    );

    return res.json({
      totalPedidos,
      pedidosCompletados,
      pedidosEnProceso,
      pedidosExpirados,
      monthlyStats,
      availableYears
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
