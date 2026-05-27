import { Router } from 'express';
import prisma from '../prismaClient';
import { resolveSucursalScope } from '../lib/sucursalContext';

const router = Router();

// Helper function to parse date string as local date (not UTC)
function parseLocalDate(dateStr: string, endOfDay: boolean = false): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (endOfDay) {
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

// Helper function to calculate dynamic estado
function calculateEstado(order: { estado: string | null; fecha_comprometida: Date | null }): string {
  if (order.estado === 'completada') {
    return 'completada';
  }
  if (order.fecha_comprometida && new Date(order.fecha_comprometida) < new Date()) {
    return 'expirada';
  }
  return 'en_proceso';
}

// Reporte de pedidos por fecha
router.get('/pedidos-por-fecha', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (sucursalError) {
      return res.status(403).json({ error: sucursalError });
    }

    const { fechaInicio, fechaFin } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Se requieren fechaInicio y fechaFin' });
    }

    const startDate = parseLocalDate(fechaInicio as string, false);
    const endDate = parseLocalDate(fechaFin as string, true);

    const where: any = {
      fecha: {
        gte: startDate,
        lte: endDate,
      },
    };
    if (sucursalId) {
      where.sucursalId = sucursalId;
    }

    const pedidos = await prisma.pedido.findMany({
      where,
      include: {
        vendedor: true,
        cliente: true,
        items: true,
      },
      orderBy: { fecha: 'desc' },
    });

    const pedidosConEstado = pedidos.map(pedido => ({
      ...pedido,
      estado: calculateEstado(pedido),
    }));

    // Resumen estadístico
    const resumen = {
      total: pedidos.length,
      completados: pedidosConEstado.filter(p => p.estado === 'completada').length,
      enProceso: pedidosConEstado.filter(p => p.estado === 'en_proceso').length,
      expirados: pedidosConEstado.filter(p => p.estado === 'expirada').length,
      totalItems: pedidos.reduce((acc, p) => acc + p.items.reduce((sum, item) => sum + item.unidades, 0), 0),
    };

    res.json({ pedidos: pedidosConEstado, resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

// Reporte de pedidos por vendedor y fecha
router.get('/pedidos-por-vendedor', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (sucursalError) {
      return res.status(403).json({ error: sucursalError });
    }

    const { vendedorId, fechaInicio, fechaFin } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Se requieren fechaInicio y fechaFin' });
    }

    const startDate = parseLocalDate(fechaInicio as string, false);
    const endDate = parseLocalDate(fechaFin as string, true);

    const where: any = {
      fecha: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (sucursalId) {
      where.sucursalId = sucursalId;
    }

    if (vendedorId && vendedorId !== 'all') {
      where.vendedorId = vendedorId as string;
    }

    const pedidos = await prisma.pedido.findMany({
      where,
      include: {
        vendedor: true,
        cliente: true,
        items: true,
      },
      orderBy: [{ vendedor: { nombre: 'asc' } }, { fecha: 'desc' }],
    });

    const pedidosConEstado = pedidos.map(pedido => ({
      ...pedido,
      estado: calculateEstado(pedido),
    }));

    // Agrupar por vendedor
    const porVendedor = pedidosConEstado.reduce((acc: any, pedido) => {
      const vendedorNombre = pedido.vendedor?.nombre || 'Sin vendedor';
      if (!acc[vendedorNombre]) {
        acc[vendedorNombre] = {
          vendedor: pedido.vendedor,
          pedidos: [],
          total: 0,
          completados: 0,
          enProceso: 0,
          expirados: 0,
        };
      }
      acc[vendedorNombre].pedidos.push(pedido);
      acc[vendedorNombre].total++;
      if (pedido.estado === 'completada') acc[vendedorNombre].completados++;
      if (pedido.estado === 'en_proceso') acc[vendedorNombre].enProceso++;
      if (pedido.estado === 'expirada') acc[vendedorNombre].expirados++;
      return acc;
    }, {});

    // Resumen general
    const resumen = {
      total: pedidos.length,
      completados: pedidosConEstado.filter(p => p.estado === 'completada').length,
      enProceso: pedidosConEstado.filter(p => p.estado === 'en_proceso').length,
      expirados: pedidosConEstado.filter(p => p.estado === 'expirada').length,
      vendedores: Object.keys(porVendedor).length,
    };

    res.json({ pedidos: pedidosConEstado, porVendedor: Object.values(porVendedor), resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

// Reporte de pedidos por estado, vendedor y fecha
router.get('/pedidos-por-estado', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (sucursalError) {
      return res.status(403).json({ error: sucursalError });
    }

    const { estado, vendedorId, fechaInicio, fechaFin } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Se requieren fechaInicio y fechaFin' });
    }

    const startDate = parseLocalDate(fechaInicio as string, false);
    const endDate = parseLocalDate(fechaFin as string, true);

    const where: any = {
      fecha: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (sucursalId) {
      where.sucursalId = sucursalId;
    }

    if (vendedorId && vendedorId !== 'all') {
      where.vendedorId = vendedorId as string;
    }

    const pedidos = await prisma.pedido.findMany({
      where,
      include: {
        vendedor: true,
        cliente: true,
        items: true,
      },
      orderBy: { fecha: 'desc' },
    });

    // Calcular estado dinámico y filtrar
    let pedidosConEstado = pedidos.map(pedido => ({
      ...pedido,
      estado: calculateEstado(pedido),
    }));

    // Filtrar por estado si se especifica
    if (estado && estado !== 'all') {
      pedidosConEstado = pedidosConEstado.filter(p => p.estado === estado);
    }

    // Agrupar por estado
    const porEstado = {
      completada: pedidosConEstado.filter(p => p.estado === 'completada'),
      en_proceso: pedidosConEstado.filter(p => p.estado === 'en_proceso'),
      expirada: pedidosConEstado.filter(p => p.estado === 'expirada'),
    };

    // Resumen
    const resumen = {
      total: pedidosConEstado.length,
      completados: porEstado.completada.length,
      enProceso: porEstado.en_proceso.length,
      expirados: porEstado.expirada.length,
      totalItems: pedidosConEstado.reduce((acc, p) => acc + p.items.reduce((sum, item) => sum + item.unidades, 0), 0),
      totalPacks: pedidosConEstado.reduce((acc, p) => acc + p.items.reduce((sum, item) => sum + (item.packs || 0), 0), 0),
    };

    res.json({ pedidos: pedidosConEstado, porEstado, resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

// Reporte de productos por vendedor - Suma totales por tipo de producto
router.get('/productos-por-vendedor', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (sucursalError) {
      return res.status(403).json({ error: sucursalError });
    }

    const { vendedorId, fechaInicio, fechaFin, estado } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Se requieren fechaInicio y fechaFin' });
    }

    const startDate = parseLocalDate(fechaInicio as string, false);
    const endDate = parseLocalDate(fechaFin as string, true);

    const where: any = {
      fecha: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (sucursalId) {
      where.sucursalId = sucursalId;
    }

    if (vendedorId && vendedorId !== 'all') {
      where.vendedorId = vendedorId as string;
    }

    const pedidos = await prisma.pedido.findMany({
      where,
      include: {
        vendedor: true,
        items: true,
      },
      orderBy: [{ vendedor: { nombre: 'asc' } }, { fecha: 'desc' }],
    });

    // Calcular estado dinámico y filtrar
    let pedidosFiltrados = pedidos.map(pedido => ({
      ...pedido,
      estadoCalculado: calculateEstado(pedido),
    }));

    // Filtrar por estado si se especifica
    if (estado && estado !== 'all') {
      pedidosFiltrados = pedidosFiltrados.filter(p => p.estadoCalculado === estado);
    }

    // Agrupar por vendedor y producto
    const productosPorVendedor: Record<string, {
      vendedor: { id: string; nombre: string; codigo: string | null } | null;
      productos: Record<string, { producto: string; totalUnidades: number; totalPacks: number; pedidosCount: number }>;
      totalUnidades: number;
      totalPacks: number;
      totalPedidos: number;
    }> = {};

    pedidosFiltrados.forEach(pedido => {
      const vendedorNombre = pedido.vendedor?.nombre || 'Sin vendedor';
      
      if (!productosPorVendedor[vendedorNombre]) {
        productosPorVendedor[vendedorNombre] = {
          vendedor: pedido.vendedor ? {
            id: pedido.vendedor.id,
            nombre: pedido.vendedor.nombre,
            codigo: pedido.vendedor.codigo,
          } : null,
          productos: {},
          totalUnidades: 0,
          totalPacks: 0,
          totalPedidos: 0,
        };
      }

      productosPorVendedor[vendedorNombre].totalPedidos++;

      pedido.items.forEach(item => {
        const productoKey = item.producto.trim().toUpperCase();
        
        if (!productosPorVendedor[vendedorNombre].productos[productoKey]) {
          productosPorVendedor[vendedorNombre].productos[productoKey] = {
            producto: item.producto,
            totalUnidades: 0,
            totalPacks: 0,
            pedidosCount: 0,
          };
        }

        productosPorVendedor[vendedorNombre].productos[productoKey].totalUnidades += item.unidades;
        productosPorVendedor[vendedorNombre].productos[productoKey].totalPacks += item.packs || 0;
        productosPorVendedor[vendedorNombre].productos[productoKey].pedidosCount++;
        
        productosPorVendedor[vendedorNombre].totalUnidades += item.unidades;
        productosPorVendedor[vendedorNombre].totalPacks += item.packs || 0;
      });
    });

    // Convertir a array para respuesta
    const resultado = Object.values(productosPorVendedor).map(vendedorData => ({
      vendedor: vendedorData.vendedor,
      productos: Object.values(vendedorData.productos).sort((a, b) => b.totalUnidades - a.totalUnidades),
      totalUnidades: vendedorData.totalUnidades,
      totalPacks: vendedorData.totalPacks,
      totalPedidos: vendedorData.totalPedidos,
    }));

    // Resumen general de productos (todos los vendedores)
    const productosGlobal: Record<string, { producto: string; totalUnidades: number; totalPacks: number; pedidosCount: number }> = {};

    Object.values(productosPorVendedor).forEach(vendedorData => {
      Object.values(vendedorData.productos).forEach(prod => {
        const key = prod.producto.trim().toUpperCase();
        if (!productosGlobal[key]) {
          productosGlobal[key] = {
            producto: prod.producto,
            totalUnidades: 0,
            totalPacks: 0,
            pedidosCount: 0,
          };
        }
        productosGlobal[key].totalUnidades += prod.totalUnidades;
        productosGlobal[key].totalPacks += prod.totalPacks;
        productosGlobal[key].pedidosCount += prod.pedidosCount;
      });
    });

    // Resumen
    const resumen = {
      totalPedidos: pedidos.length,
      totalVendedores: Object.keys(productosPorVendedor).length,
      totalProductosTipos: Object.keys(productosGlobal).length,
      totalUnidades: Object.values(productosGlobal).reduce((acc, p) => acc + p.totalUnidades, 0),
      totalPacks: Object.values(productosGlobal).reduce((acc, p) => acc + p.totalPacks, 0),
    };

    res.json({ 
      porVendedor: resultado, 
      productosGlobal: Object.values(productosGlobal).sort((a, b) => b.totalUnidades - a.totalUnidades),
      resumen 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

// Obtener lista de vendedores para los filtros
router.get('/vendedores', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (sucursalError) {
      return res.status(403).json({ error: sucursalError });
    }

    const vendedores = await prisma.vendedor.findMany({
      where: sucursalId ? { sucursalId } : {},
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        nombre: true,
        codigo: true,
      },
    });
    res.json(vendedores);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener vendedores' });
  }
});

export default router;
