import { Router } from 'express';
import prisma from '../prismaClient';
import { mapCsvRecords, type OrderRecordDto } from '../dto/orderRecord.dto';


const router = Router();

// List orders with pagination and filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const estado = req.query.estado as string | undefined;
    const search = req.query.search as string | undefined;
    const searchTerm = search ? search.toUpperCase() : undefined;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
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

// Create a new order (basic)
router.post('/', async (req, res) => {
  try {
    const { folio, sellerId, clientId, direccion, encargado, telefono, fecha, fecha_comprometida, items } = req.body;

    const order = await prisma.pedido.create({
      data: {
        folio: folio?.toUpperCase() || '',
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

    // Check if order exists
    const existingOrder = await prisma.pedido.findUnique({
      where: { id },
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

// Bulk create orders from CSV records
router.post('/bulk', async (req, res) => {
  try {
    const { records } = req.body;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid records data' });
    }

    // Map CSV records to DTO
    const mappedRecords = mapCsvRecords(records);

    const results = {
      created: 0,
      updated: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Process mapped records
    for (const record of mappedRecords) {
      try {
        await processOrderRecord(record, results);
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

async function processOrderRecord(record: OrderRecordDto, results: any) {
  // Find or create seller
  let seller = await prisma.vendedor.findFirst({
    where: {
      OR: [
        { nombre: record.seller.name.toUpperCase() },
        { codigo: record.seller.code },
      ],
    },
  });

  if (seller) {
    // Update existing seller
    seller = await prisma.vendedor.update({
      where: { id: seller.id },
      data: {
        nombre: record.seller.name,
        codigo: record.seller.code,
      },
    });
  } else {
    // Create new seller
    seller = await prisma.vendedor.create({
      data: {
        nombre: record.seller.name,
        codigo: record.seller.code,
      },
    });
  }

  // Upsert client - need to find by nombre first to get codigo for where clause
  let existingClient = await prisma.cliente.findFirst({
    where: { nombre: record.client.nombre.toUpperCase() },
  });

  let client;
  if (existingClient) {
    // Update existing client
    client = await prisma.cliente.update({
      where: { id: existingClient.id },
      data: {
        nombre: record.client.nombre,
        zona: record.client.zona,
        // codigo: record.client.codigo,
      },
    });
  } else {
    
    client = await prisma.cliente.create({
      data: {
        // codigo: record.client.codigo,
        nombre: record.client.nombre,
        zona: record.client.zona,
      },
    });
  }

  // Extract base folio (remove only small suffixes like -1, -2, NOT the folio number like -1130)
  // Only match suffixes of 1-2 digits at the very end (our generated suffixes)
  const baseFolioMatch = record.order.folio.match(/^(.+)-(\d{1,2})$/);
  const baseFolio = baseFolioMatch ? baseFolioMatch[1] : record.order.folio;

  // Check if order already exists for THIS client (with base folio or any suffix)
  const existingOrder = await prisma.pedido.findFirst({
    where: {
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
    if (record.order.fecha_comprometida) {
      const existingFecha = existingOrder.fecha_comprometida;
      const newFecha = record.order.fecha_comprometida;
      
      // Update if existing has no fecha_comprometida, or if new fecha is later
      if (!existingFecha || newFecha > existingFecha) {
        await prisma.pedido.update({
          where: { id: existingOrder.id },
          data: {
            fecha_comprometida: newFecha,
          },
        });
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
        vendedorId: seller.id,
        clienteId: client.id,
        direccion: record.order.direccion,
        encargado: record.order.encargado,
        telefono: record.order.telefono,
        fecha: record.order.fecha,
        fecha_comprometida: record.order.fecha_comprometida,
        estado: 'en_proceso',
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
      where: yearCondition
    });

    // Pedidos completados
    const pedidosCompletados = await prisma.pedido.count({
      where: {
        estado: 'completada',
        ...yearCondition
      }
    });

    // Pedidos en proceso (no completados y no expirados)
    const pedidosEnProceso = await prisma.pedido.count({
      where: {
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
