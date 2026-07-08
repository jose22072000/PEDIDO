import express from 'express';
import prisma from '../prismaClient';
import {
  getRequesterContext,
  requireSucursalId,
  resolveSucursalScope,
} from '../lib/sucursalContext';

const router = express.Router();

// GET /vendedores - List all vendedores
router.get('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
    }

    const vendedores = await prisma.vendedor.findMany({
      where: { sucursalId },
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

// GET /vendedores/gestores
// Datos para enlazar vendedor <-> gestor desde la vista de Vendedores.
// Scopeado: el Super Admin ve todos; el resto ve los de SU sucursal MÁS los que aún
// no tienen ninguna (los "sin asignar"), que si no serían imposibles de enlazar.
router.get('/gestores', async (req, res) => {
  try {
    const { isGlobalAdmin } = getRequesterContext(req);
    const { sucursalId, error: scopeError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: true,
    });
    if (scopeError) return res.status(403).json({ error: scopeError });
    if (!isGlobalAdmin && !sucursalId) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada.' });
    }

    const scopeVendedores = sucursalId
      ? { OR: [{ sucursalId }, { sucursalId: null }] }
      : {};
    const scopeGestores = sucursalId ? { sucursalId } : {};

    const [vendedores, gestores] = await Promise.all([
      prisma.vendedor.findMany({
        where: scopeVendedores,
        include: {
          gestor: { select: { id: true, username: true, sucursalId: true } },
          sucursal: { select: { id: true, nombre: true, codigo: true } },
          _count: { select: { pedidos: true } },
        },
        orderBy: [{ nombre: 'asc' }],
      }),
      prisma.usuario.findMany({
        where: { rol: { nombre: 'Gestor' }, ...scopeGestores },
        select: {
          id: true,
          username: true,
          sucursalId: true,
          sucursal: { select: { nombre: true, codigo: true } },
        },
        orderBy: { username: 'asc' },
      }),
    ]);

    res.json({
      gestores,
      vendedores,
      // "Sin asignar" solo cuenta a los vendedores activos (los de baja no importan).
      sinAsignar: vendedores.filter((v) => v.activo && !v.gestorId).length,
      inactivos: vendedores.filter((v) => !v.activo).length,
    });
  } catch (error) {
    console.error('Error fetching gestores:', error);
    res.status(500).json({ error: 'Error al obtener gestores' });
  }
});

// PATCH /vendedores/:id/activo   body: { activo: boolean }
// Baja/alta del vendedor. Al darlo de baja deja de aceptarse su CSV y desaparece de
// las listas, pero se CONSERVA su histórico de pedidos (no se borra nada).
router.patch('/:id/activo', async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body as { activo?: boolean };
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ error: 'Falta el campo booleano "activo"' });
    }

    const vendedor = await prisma.vendedor.findUnique({
      where: { id },
      include: { _count: { select: { pedidos: true } } },
    });
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado' });

    const updated = await prisma.vendedor.update({ where: { id }, data: { activo } });

    res.json({
      vendedor: updated,
      pedidosConservados: vendedor._count.pedidos,
    });
  } catch (error) {
    console.error('Error updating vendedor activo:', error);
    res.status(500).json({ error: 'Error al actualizar el vendedor' });
  }
});

// PATCH /vendedores/:id/gestor   body: { gestorId: string | null }
// Enlaza el vendedor a un gestor. Como la sucursal del pedido se deriva del gestor,
// al enlazar hay que RELLENAR la sucursal de los pedidos y clientes de ese vendedor
// que quedaron en null mientras estaba "Sin asignar" -> dejan de estar ocultos.
router.patch('/:id/gestor', async (req, res) => {
  try {
    const { id } = req.params;
    const { gestorId } = req.body as { gestorId?: string | null };

    const requester = getRequesterContext(req);

    const vendedor = await prisma.vendedor.findUnique({ where: { id } });
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado' });

    // Un usuario scopeado solo toca vendedores de su sucursal (o los sin asignar).
    if (
      !requester.isGlobalAdmin &&
      vendedor.sucursalId &&
      vendedor.sucursalId !== requester.sucursalId
    ) {
      return res.status(403).json({ error: 'Ese vendedor es de otra sucursal.' });
    }

    let sucursalId: string | null = null;
    if (gestorId) {
      const gestor = await prisma.usuario.findUnique({
        where: { id: gestorId },
        include: { rol: true },
      });
      if (!gestor) return res.status(404).json({ error: 'Gestor no encontrado' });
      if (gestor.rol?.nombre !== 'Gestor') {
        return res.status(400).json({ error: 'Ese usuario no tiene rol Gestor' });
      }
      if (!gestor.sucursalId) {
        return res.status(400).json({ error: 'El gestor no tiene sucursal asignada' });
      }
      // Y tampoco puede enlazarlo a un gestor de otra sucursal.
      if (!requester.isGlobalAdmin && gestor.sucursalId !== requester.sucursalId) {
        return res.status(403).json({ error: 'Ese gestor es de otra sucursal.' });
      }
      sucursalId = gestor.sucursalId;
    }

    const result = await prisma.$transaction(async (tx) => {
      const v = await tx.vendedor.update({
        where: { id },
        // Al desenlazar (gestorId null) el vendedor queda "Sin asignar" de nuevo,
        // pero NO se le quita la sucursal a sus pedidos históricos.
        data: { gestorId: gestorId || null, ...(sucursalId ? { sucursalId } : {}) },
      });

      let pedidos = 0;
      let clientes = 0;
      if (sucursalId) {
        const p = await tx.pedido.updateMany({
          where: { vendedorId: id, sucursalId: null },
          data: { sucursalId },
        });
        pedidos = p.count;

        const clienteIds = (
          await tx.pedido.findMany({ where: { vendedorId: id }, select: { clienteId: true } })
        )
          .map((x) => x.clienteId)
          .filter((x): x is string => !!x);

        if (clienteIds.length) {
          const c = await tx.cliente.updateMany({
            where: { id: { in: clienteIds }, sucursalId: null },
            data: { sucursalId },
          });
          clientes = c.count;
        }
      }
      return { v, pedidos, clientes };
    });

    res.json({
      vendedor: result.v,
      backfill: { pedidos: result.pedidos, clientes: result.clientes },
    });
  } catch (error) {
    console.error('Error linking gestor:', error);
    res.status(500).json({ error: 'Error al enlazar el gestor' });
  }
});

// GET /vendedores/:id/stats?year=YYYY - Get vendedor stats by year
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const { year } = req.query;
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
    }

    let whereClause: any = {
      vendedorId: id,
      sucursalId,
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
      where: { vendedorId: id, sucursalId, fecha_comprometida: { not: null } },
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
