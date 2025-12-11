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
        codigo: record.client.codigo,
      },
    });
  } else {

    client = await prisma.cliente.create({
      data: {
        codigo: record.client.codigo,
        nombre: record.client.nombre,
        zona: record.client.zona,
      },
    });
  }

  // Check if order already exists
  const existingOrder = await prisma.pedido.findFirst({
    where: {
      folio: record.order.folio,
      vendedorId: seller.id,
    },
    include: {
      items: true,
    },
  });

  if (existingOrder) {
    // Check if item already exists in this order
    const existingItem = existingOrder.items.find(
      (item) => item.producto.toUpperCase() === record.item.producto.toUpperCase(),
    );

    if (existingItem) {
      // Update existing item quantity
      await prisma.pedidoItem.update({
        where: { id: existingItem.id },
        data: {
          unidades: existingItem.unidades + record.item.unidades,
        },
      });
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
        folio: record.order.folio,
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

    // Total de pedidos (sin importar estado)
    const totalPedidos = await prisma.pedido.count();

    // Pedidos completados
    const pedidosCompletados = await prisma.pedido.count({
      where: {
        estado: 'completada'
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
        ]
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
        ]
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
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // 1-12
        const key = `${year}-${month}`;

        yearsSet.add(year);

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
      const [year, month] = key.split('-').map(Number);
      return {
        year,
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
