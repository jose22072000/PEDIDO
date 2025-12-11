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

    // Get counts by estado
    const [totalPedidos, pedidosCompletados, pedidosEnProceso, pedidosExpirados] = await Promise.all([
      prisma.pedido.count({ where: whereClause }),
      prisma.pedido.count({ where: { ...whereClause, estado: 'completada' } }),
      prisma.pedido.count({ where: { ...whereClause, estado: 'en_proceso' } }),
      prisma.pedido.count({ where: { ...whereClause, estado: 'expirada' } })
    ]);

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
