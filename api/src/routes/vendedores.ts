import express from 'express';
import prisma from '../prismaClient';
import { emitEvent } from '../lib/events';
import {
  getRequesterContext,
  resolveSucursalFilter,
  resolveSucursalScope,
} from '../lib/sucursalContext';

const router = express.Router();

// Roles que pueden "llevar" vendedores (ser su gestor). Un vendedor SIN enlace queda
// "sin asignar" y sus pedidos NO aparecen en la vista (que scopea por la sucursal del
// gestor). El Supervisor también sube pedidos, así que también tiene que poder llevarlos.
const ROLES_ENLAZABLES = ['Gestor', 'Supervisor'];

// Mismo `include` que la lista de /gestores: el evento SSE tiene que llevar el
// vendedor con EXACTAMENTE la forma que la vista ya tiene en pantalla, para poder
// sustituirlo en sitio sin volver a pedir la lista entera.
const FORMA_LISTA = {
  gestor: { select: { id: true, username: true, sucursalId: true } },
  sucursal: { select: { id: true, nombre: true, codigo: true } },
  _count: { select: { pedidos: true } },
} as const;

/**
 * Publica el vendedor COMPLETO por SSE para que las vistas lo apliquen en sitio.
 *
 * Si cambió de sucursal se emite DOS veces, una por cada sucursal implicada: el
 * SSE filtra por sucursal, así que sin el segundo evento la sucursal que lo
 * perdía se quedaba enseñándolo hasta que alguien recargara.
 */
async function emitirVendedor(id: string, accion: string, sucursalAnterior?: string | null) {
  const v = await prisma.vendedor.findUnique({ where: { id }, include: FORMA_LISTA });
  if (!v) return;

  const destinos = new Set<string | null>([v.sucursalId ?? null]);
  if (sucursalAnterior !== undefined) destinos.add(sucursalAnterior ?? null);

  for (const sucursalId of destinos) {
    emitEvent('vendedor', { sucursalId, id: v.id, accion, datos: v });
  }
}

// GET /vendedores - List all vendedores
router.get('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalFilter(req);
    if (sucursalError) {
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

// GET /vendedores/usuarios
// Lista para el desplegable "Vendedor" de la lista de pedidos: devuelve al USUARIO
// vinculado (el gestor), NO al vendedor crudo. Es el usuario quien tiene la sucursal,
// así el operador filtra por la persona de SU sucursal. Un usuario que gestiona varios
// vendedores sale UNA sola vez, y no salen duplicados por vendedores con encoding
// distinto (p. ej. dos "Alexander") ni vendedores sin usuario asignado. El filtro de
// pedidos (GET /orders?usuarioId=) usa este id (vendedor.gestorId = usuario.id).
router.get('/usuarios', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalFilter(req);
    if (sucursalError) {
      return res.status(400).json({ error: sucursalError });
    }

    const usuarios = await prisma.usuario.findMany({
      where: {
        ...(sucursalId ? { sucursalId } : {}),
        vendedores: { some: {} }, // solo usuarios que gestionan al menos un vendedor
      },
      orderBy: { username: 'asc' },
      select: { id: true, username: true },
    });
    res.json(usuarios.map((u) => ({ id: u.id, nombre: u.username })));
  } catch (error) {
    console.error('Error fetching vendedores/usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios vendedores' });
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

    // Los vendedores SIN sucursal se enseñan solo a quien puede enlazarlos: si
    // no, seria imposible asignarles gestor. A quien solo lee —el Operador, que
    // entra a copiar el codigo para facturar— se le enseña UNICAMENTE su
    // sucursal; los sin asignar son de cualquier otra y para el son ruido.
    const puedeGestionar = getRequesterContext(req).puedeGestionarVendedores;
    const scopeVendedores = sucursalId
      ? puedeGestionar
        ? { OR: [{ sucursalId }, { sucursalId: null }] }
        : { sucursalId }
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
        // El Supervisor TAMBIÉN sube pedidos, así que también debe poder enlazarse a un
        // vendedor: si no, esos vendedores quedan "sin asignar" y sus pedidos NO salen
        // en la vista (que scopea por sucursal del gestor).
        where: { rol: { nombre: { in: ROLES_ENLAZABLES } }, ...scopeGestores },
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
    // El Operador solo LEE esta vista (factura y copia el codigo al
    // portapapeles). Ocultarle los botones en la pantalla no es proteccion:
    // la comprobacion de verdad va aqui.
    if (!getRequesterContext(req).puedeGestionarVendedores) {
      return res.status(403).json({ error: 'No tienes permiso para modificar vendedores.' });
    }
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

    // Un usuario scopeado solo da de baja/alta vendedores de SU sucursal.
    const requester = getRequesterContext(req);
    if (
      !requester.isGlobalAdmin &&
      vendedor.sucursalId &&
      vendedor.sucursalId !== requester.sucursalId
    ) {
      return res.status(403).json({ error: 'Ese vendedor es de otra sucursal.' });
    }

    const updated = await prisma.vendedor.update({ where: { id }, data: { activo } });

    await emitirVendedor(updated.id, 'update');
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
    // El Operador solo LEE esta vista (factura y copia el codigo al
    // portapapeles). Ocultarle los botones en la pantalla no es proteccion:
    // la comprobacion de verdad va aqui.
    if (!getRequesterContext(req).puedeGestionarVendedores) {
      return res.status(403).json({ error: 'No tienes permiso para modificar vendedores.' });
    }
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
      if (!ROLES_ENLAZABLES.includes(gestor.rol?.nombre ?? '')) {
        return res.status(400).json({
          error: `Ese usuario no puede llevar vendedores: se requiere rol ${ROLES_ENLAZABLES.join(' o ')}.`,
        });
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
        // La sucursal del vendedor ES la de su gestor. Al desenlazar vuelve a
        // "Sin asignar" y se queda SIN sucursal (antes conservaba la vieja, que
        // es como acababan apareciendo vendedores sin gestor dentro de una
        // sucursal). Sus pedidos históricos no se tocan al desenlazar.
        data: { gestorId: gestorId || null, sucursalId },
      });

      let pedidos = 0;
      let clientes = 0;
      if (sucursalId) {
        // TODOS sus pedidos, no solo los que estaban en null. Si el vendedor
        // arrastraba pedidos en la sucursal equivocada (heredada del que subió
        // el CSV), enlazar al gestor los recoloca donde de verdad van.
        const p = await tx.pedido.updateMany({
          where: { vendedorId: id, NOT: { sucursalId } },
          data: { sucursalId },
        });
        pedidos = p.count;

        const clienteIds = (
          await tx.pedido.findMany({ where: { vendedorId: id }, select: { clienteId: true } })
        )
          .map((x) => x.clienteId)
          .filter((x): x is string => !!x);

        if (clienteIds.length) {
          // En clientes solo se rellenan los huérfanos: un cliente puede comprarle
          // a vendedores de más de una sucursal, así que no se le pisa la suya.
          const c = await tx.cliente.updateMany({
            where: { id: { in: clienteIds }, sucursalId: null },
            data: { sucursalId },
          });
          clientes = c.count;
        }
      }
      return { v, pedidos, clientes };
    });

    // En vivo: el vínculo cambia el vendedor y (por backfill) sus pedidos + clientes.
    // El vendedor viaja completo; los pedidos/clientes son demasiados para mandarlos
    // uno a uno, así que esos sí piden un refresco (de fondo, sin esqueleto).
    await emitirVendedor(result.v.id, 'update', vendedor.sucursalId);
    if (result.pedidos > 0) emitEvent('pedido', { sucursalId: result.v.sucursalId, accion: 'backfill' });
    if (result.clientes > 0) emitEvent('cliente', { sucursalId: result.v.sucursalId, accion: 'backfill' });

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
    const { sucursalId, error: sucursalError } = resolveSucursalFilter(req);
    if (sucursalError) {
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
