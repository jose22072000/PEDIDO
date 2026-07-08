import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import { mapCsvRecords, type OrderRecordDto } from '../dto/orderRecord.dto';
import { requireSucursalId, resolveSucursalScope } from '../lib/sucursalContext';


const router = Router();

// List orders with pagination and filters
router.get('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const estado = req.query.estado as string | undefined;
    const search = req.query.search as string | undefined;
    const fechaDesde = req.query.fechaDesde as string | undefined;
    const fechaHasta = req.query.fechaHasta as string | undefined;
    const searchTerm = search ? search.toUpperCase() : undefined;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = { sucursalId };
    const conditions: any[] = [];

    // General search filter (vendedor, cliente, folio)
    if (searchTerm) {
      conditions.push({
        OR: [
          {
            folio: {
              contains: searchTerm,
            },
          },
          {
            vendedor: {
              nombre: {
                contains: searchTerm,
              },
            },
          },
          {
            cliente: {
              nombre: {
                contains: searchTerm,
              },
            },
          },
          {
            cliente: {
              codigo: {
                contains: searchTerm,
              },
            },
          },
          {
            encargado: {
              contains: searchTerm,
            },
          },
        ],
      });
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

    // Filter by date range (on 'fecha' field)
    // Use noon UTC of each boundary day to safely cover any local-time noon stored date
    if (fechaDesde || fechaHasta) {
      const dateFilter: any = {};
      if (fechaDesde) {
        // Start of day: go back one day extra (previous day T12:00:00Z) to catch any TZ edge
        const from = new Date(fechaDesde + 'T00:00:00.000Z');
        dateFilter.gte = from;
      }
      if (fechaHasta) {
        // End of day: use next day T11:59:59Z to cover noon stored dates
        const to = new Date(fechaHasta + 'T23:59:59.999Z');
        dateFilter.lte = to;
      }
      conditions.push({ fecha: dateFilter });
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
    const ordersWithStatus = orders.map(order => {
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
router.get('/stream', async (req, res) => {
  const { sucursalId, error } = requireSucursalId(req);
  if (error || !sucursalId) {
    return res.status(400).json({ error: error || 'Sin sucursal' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();

  let closed = false;
  let since = new Date(); // solo pedidos creados DESPUÉS de conectarse

  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const computeEstado = (o: { estado: string | null; fecha_comprometida: Date | null }) => {
    if (o.estado === 'completada') return 'completada';
    if (o.fecha_comprometida && new Date(o.fecha_comprometida) < new Date()) return 'expirada';
    return 'en_proceso';
  };

  send('ready', { since: since.toISOString() });

  const tick = async () => {
    if (closed) return;
    try {
      const nuevos = await prisma.pedido.findMany({
        where: { sucursalId, createdAt: { gt: since } },
        include: { items: true, cliente: true, vendedor: true },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      if (nuevos.length) {
        since = nuevos[nuevos.length - 1].createdAt;
        for (const o of nuevos) send('order', { ...o, estado: computeEstado(o) });
      }
    } catch {
      /* transitorio; el próximo tick reintenta */
    }
  };

  const interval = setInterval(tick, 3000);
  const keepAlive = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 20000);
  req.on('close', () => {
    closed = true;
    clearInterval(interval);
    clearInterval(keepAlive);
  });
});

// Create a new order (basic)
router.post('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
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

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Update order status to completada
router.patch('/:id/completar', async (req, res) => {
  try {
    const { id } = req.params;
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
    }

    const existingOrder = await prisma.pedido.findFirst({
      where: { id, sucursalId },
      select: { id: true },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const order = await prisma.pedido.update({
      where: { id },
      data: { estado: 'completada' },
      include: { items: true, cliente: true, vendedor: true },
    });

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Delete an order (requires Administrador or Supervisor role)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
    }

    // Check if order exists
    const existingOrder = await prisma.pedido.findFirst({
      where: { id, sucursalId },
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

// `uploaderSucursalId` = la sucursal del que sube (como SIEMPRE se ha hecho). El
// gestor solo AÑADE una forma de rutear cuando existe; si no, todo sigue igual.
async function resolveSeller(
  name: string,
  code: string,
  uploaderSucursalId: string | null,
): Promise<SellerResolution> {
  const nombre = name.toUpperCase().trim();

  // 1) Por código (clave nueva). 2) Si no aparece, POR NOMBRE: así seguimos
  //    encontrando a los vendedores creados con la regla de código vieja
  //    ("glenda.melisa") y les corregimos el código al vuelo, sin duplicarlos.
  let existing = code
    ? await prisma.vendedor.findUnique({ where: { codigo: code }, include: { gestor: true } })
    : null;

  if (!existing) {
    const porNombre = await prisma.vendedor.findFirst({
      where: { nombre: { equals: name } },
      include: { gestor: true },
    });
    if (porNombre) {
      if (!porNombre.activo) throw new VendedorInactivoError(porNombre.nombre);
      if (code && porNombre.codigo !== code) {
        try {
          existing = await prisma.vendedor.update({
            where: { id: porNombre.id },
            data: { codigo: code },
            include: { gestor: true },
          });
        } catch (e) {
          // El código nuevo ya lo tiene OTRA persona -> colisión real.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const dueno = await prisma.vendedor.findUnique({ where: { codigo: code } });
            throw new VendedorColisionError(code, dueno?.nombre ?? '(otro)', name);
          }
          throw e;
        }
      } else {
        existing = porNombre;
      }
    }
  }

  if (existing) {
    if (existing.nombre.toUpperCase().trim() !== nombre) {
      throw new VendedorColisionError(code, existing.nombre, name);
    }
    // Vendedor dado de baja: su CSV ya no debería llegar; si llega, se rechaza.
    if (!existing.activo) {
      throw new VendedorInactivoError(existing.nombre);
    }
    // Sucursal: la del gestor si está enlazado; si no, la del que sube (como hasta
    // ahora); si tampoco (p. ej. Super Admin en la nube), la propia del vendedor.
    // Solo queda null —y por tanto oculto— si no hay ninguna de las tres.
    const sucursalId =
      existing.gestor?.sucursalId ?? uploaderSucursalId ?? existing.sucursalId ?? null;

    // Si el vendedor aún no tenía sucursal, se la fijamos (comportamiento de siempre).
    if (!existing.sucursalId && sucursalId) {
      await prisma.vendedor.update({ where: { id: existing.id }, data: { sucursalId } });
    }
    return { seller: existing, sucursalId };
  }

  // Vendedor nuevo: se crea en la sucursal del que sube (igual que antes). Queda sin
  // gestor hasta que se le enlace uno desde la vista de Vendedores.
  const seller = await prisma.vendedor.create({
    data: { nombre: name, codigo: code || null, sucursalId: uploaderSucursalId, gestorId: null },
  });
  return { seller, sucursalId: uploaderSucursalId };
}

// Bulk create orders from CSV records
router.post('/bulk', async (req, res) => {
  try {
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

    // Map CSV records to DTO
    const mappedRecords = mapCsvRecords(records);

    // El CSV es de UN vendedor (a veces más). Resolvemos TODOS los vendedores antes
    // de importar nada: si alguno colisiona, se rechaza el archivo completo.
    const sellersByCode = new Map<string, SellerResolution>();
    try {
      for (const r of mappedRecords) {
        const key = r.seller.code || r.seller.name.toUpperCase().trim();
        if (!sellersByCode.has(key)) {
          sellersByCode.set(
            key,
            await resolveSeller(r.seller.name, r.seller.code, uploaderSucursalId ?? null),
          );
        }
      }
    } catch (error) {
      if (error instanceof VendedorColisionError || error instanceof VendedorInactivoError) {
        return res.status(409).json({ error: error.message, imported: 0 });
      }
      throw error;
    }

    const results = {
      created: 0,
      updated: 0,
      failed: 0,
      sinAsignar: 0,
      errors: [] as any[],
    };

    // Process mapped records
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

    res.json({
      success: true,
      results,
    });
  } catch (err) {
    console.error('Bulk create error:', err);
    res.status(500).json({ error: 'Failed to create orders' });
  }
});

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
  let existingClient = await prisma.cliente.findFirst({
    where: { nombre: record.client.nombre.toUpperCase(), sucursalId },
  });

  let client;
  if (existingClient) {
    const incomingCode = record.client.codigo?.toString().trim() || null;
    const canUpdateCode =
      !!incomingCode &&
      (!existingClient.codigo || existingClient.codigo.trim() === '' || existingClient.codigo === incomingCode);

    // Update existing client
    client = await prisma.cliente.update({
      where: { id: existingClient.id },
      data: {
        nombre: record.client.nombre,
        zona: record.client.zona,
        sucursalId,
        codigo: canUpdateCode ? incomingCode : existingClient.codigo,
      },
    });
  } else {
    const incomingCode = record.client.codigo?.toString().trim() || null;

    try {
      client = await prisma.cliente.create({
        data: {
          codigo: incomingCode,
          nombre: record.client.nombre,
          zona: record.client.zona,
          sucursalId,
        },
      });
    } catch (error) {
      // If codigo is duplicated in source CSVs, keep import working by creating
      // the client without codigo instead of failing the whole bulk upload.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        client = await prisma.cliente.create({
          data: {
            nombre: record.client.nombre,
            zona: record.client.zona,
            sucursalId,
          },
        });
      } else {
        throw error;
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
    if (record.order.requiere_domicilio !== undefined) {
      updateData.requiere_domicilio = record.order.requiere_domicilio;
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.pedido.update({
        where: { id: existingOrder.id },
        data: updateData,
      });
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
          },
        });
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
            unidades: record.item.unidades,
            packs: record.item.packs,
            descripcion: record.item.descripcion,
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
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
    }

    const now = new Date();
    const year = req.query.year ? parseInt(req.query.year as string) : null;

    // Condición de año si se especifica
    const yearCondition = year ? {
      fecha_comprometida: {
        gte: new Date(year, 0, 1), // 1 de enero del año
        lt: new Date(year + 1, 0, 1) // 1 de enero del siguiente año
      }
    } : {};

    // Total de pedidos (del año seleccionado o todos)
    const totalPedidos = await prisma.pedido.count({
      where: {
        sucursalId,
        ...yearCondition,
      }
    });

    // Pedidos completados
    const pedidosCompletados = await prisma.pedido.count({
      where: {
        sucursalId,
        estado: 'completada',
        ...yearCondition
      }
    });

    // Pedidos en proceso (no completados y no expirados)
    const pedidosEnProceso = await prisma.pedido.count({
      where: {
        sucursalId,
        OR: [
          { estado: null },
          { estado: { not: 'completada' } }
        ],
        AND: [
          {
            OR: [
              { fecha_comprometida: null },
              { fecha_comprometida: { gte: now } }
            ]
          }
        ],
        ...yearCondition
      }
    });

    // Pedidos expirados (no completados y con fecha vencida)
    const pedidosExpirados = await prisma.pedido.count({
      where: {
        sucursalId,
        OR: [
          { estado: null },
          { estado: { not: 'completada' } }
        ],
        AND: [
          {
            fecha_comprometida: { lt: now }
          }
        ],
        ...yearCondition
      }
    });

    // Estadísticas mensuales
    const allOrders = await prisma.pedido.findMany({
      where: { sucursalId },
      select: {
        fecha_comprometida: true,
        estado: true
      }
    });

    // Agrupar por año y mes
    const monthlyStatsMap = new Map<string, { total: number; completed: number }>();
    const yearsSet = new Set<number>();

    allOrders.forEach(order => {
      if (order.fecha_comprometida) {
        const date = new Date(order.fecha_comprometida);
        const orderYear = date.getFullYear();
        const month = date.getMonth() + 1; // 1-12
        const key = `${orderYear}-${month}`;

        yearsSet.add(orderYear);

        if (!monthlyStatsMap.has(key)) {
          monthlyStatsMap.set(key, { total: 0, completed: 0 });
        }

        const stats = monthlyStatsMap.get(key)!;
        stats.total++;
        if (order.estado === 'completada') {
          stats.completed++;
        }
      }
    });

    // Convertir a array
    const monthlyStats = Array.from(monthlyStatsMap.entries()).map(([key, stats]) => {
      const [statsYear, month] = key.split('-').map(Number);
      return {
        year: statsYear,
        month,
        total: stats.total,
        completed: stats.completed
      };
    });

    // Años disponibles ordenados descendente
    const availableYears = Array.from(yearsSet).sort((a, b) => b - a);

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
