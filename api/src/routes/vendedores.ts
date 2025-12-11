import express from 'express';
import prisma from '../prismaClient';

const router = express.Router();

// GET /vendedores - List all vendedores
router.get('/', async (req, res) => {
  try {
    const vendedores = await prisma.vendedor.findMany({
      orderBy: {
        nombre: 'asc'
      }
    });

    res.json(vendedores);
  } catch (error) {
    console.error('Error fetching vendedores:', error);
    res.status(500).json({ error: 'Error al obtener vendedores' });
  }
});

// GET /vendedores/:id/stats?year=YYYY - Get vendedor stats by year
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const { year } = req.query;

    let whereClause: any = {
      vendedorId: id
    };

    // Filter by year if provided
    if (year) {
      const yearNum = parseInt(year as string);
      const startDate = new Date(yearNum, 0, 1);
      const endDate = new Date(yearNum + 1, 0, 1);

      whereClause.fecha_comprometida = {
        gte: startDate,
        lt: endDate
      };
    }

    // Get all pedidos to calculate estados dynamically
    const allPedidos = await prisma.pedido.findMany({
      where: whereClause,
      select: {
        id: true,
        estado: true,
        fecha_comprometida: true
      }
    });

    const totalPedidos = allPedidos.length;
    
    // Calculate estados
    let pedidosCompletados = 0;
    let pedidosEnProceso = 0;
    let pedidosExpirados = 0;
    const now = new Date();

    allPedidos.forEach(pedido => {
      if (pedido.estado === 'completada') {
        pedidosCompletados++;
      } else if (pedido.fecha_comprometida && new Date(pedido.fecha_comprometida) < now) {
        pedidosExpirados++;
      } else {
        pedidosEnProceso++;
      }
    });

    // Get available years for this vendedor
    const pedidosWithDates = await prisma.pedido.findMany({
      where: { vendedorId: id, fecha_comprometida: { not: null } },
      select: { fecha_comprometida: true }
    });

    const years = [...new Set(
      pedidosWithDates
        .map(p => p.fecha_comprometida ? new Date(p.fecha_comprometida).getFullYear() : null)
        .filter((y): y is number => y !== null)
    )].sort((a, b) => b - a);

    res.json({
      totalPedidos,
      pedidosCompletados,
      pedidosEnProceso,
      pedidosExpirados,
      availableYears: years
    });
  } catch (error) {
    console.error('Error fetching vendedor stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas del vendedor' });
  }
});

export default router;
