import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import { emitEvent } from '../lib/events';
import {
  nombreComparable,
  codigoDesdeNombre,
  normalizarCodigoManual,
} from '../lib/nombreVendedor';
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

// GET /vendedores/vista-previa?nombre=...
//
// Enseña, ANTES de guardar, cómo va a quedar el vendedor: el nombre ya aplanado,
// el código que se le va a poner y si choca con alguien que ya existe.
//
// Existe por dos razones. La primera es que la regla del código NO se repite en
// el front: si estuviera copiada allí, sería la cuarta copia y volveríamos justo
// al problema que este cambio arregla. La segunda es que el choque más caro no
// es el que da error al guardar, sino el que NO lo da: teclear otra vez a
// alguien que ya está con el nombre un poco distinto. Verlo antes de darle al
// botón evita ese duplicado.
router.get('/vista-previa', async (req, res) => {
  try {
    if (!getRequesterContext(req).puedeGestionarVendedores) {
      return res.status(403).json({ error: 'No tienes permiso.' });
    }

    const nombre = nombreComparable(String(req.query.nombre ?? ''));
    if (!nombre) return res.json({ nombre: '', codigo: '', existente: null });

    const codigo = normalizarCodigoManual(
      String(req.query.codigo ?? '').trim() || codigoDesdeNombre(nombre),
    ).codigo;

    // El mismo par de comprobaciones que hace el alta, para que lo que se avisa
    // aquí y lo que rechaza el POST no puedan discrepar.
    const [porCodigo, porNombre] = await Promise.all([
      codigo
        ? prisma.vendedor.findUnique({
            where: { codigo },
            include: { sucursal: { select: { nombre: true } } },
          })
        : null,
      prisma.vendedor.findFirst({
        where: { nombre: { equals: nombre, mode: 'insensitive' } },
        include: { sucursal: { select: { nombre: true } } },
      }),
    ]);

    const existente = porCodigo ?? porNombre;

    res.json({
      nombre,
      codigo,
      existente: existente
        ? {
            id: existente.id,
            nombre: existente.nombre,
            codigo: existente.codigo,
            sucursal: existente.sucursal?.nombre ?? null,
            activo: existente.activo,
            porCodigo: !!porCodigo,
          }
        : null,
    });
  } catch (error) {
    console.error('Error en vista previa de vendedor:', error);
    res.status(500).json({ error: 'Error al comprobar el vendedor' });
  }
});

// POST /vendedores   body: { nombre, codigo?, gestorId }
//
// Alta MANUAL de un vendedor, para los que no usan tablet: sin esto un vendedor
// solo podía nacer cuando llegaba su CSV, así que quien no exporta desde Parranda
// no existía en el sistema y sus pedidos no se podían meter en ningún sitio.
//
// Es la parte delicada de todo esto, porque escribe en el MISMO espacio de
// identidad que la ingesta automática. Lo que lo hace seguro:
//
//   - el nombre y el código se aplanan con `lib/nombreVendedor`, el mismo módulo
//     que usa la ingesta, así que el CSV de esta persona —si algún día llega—
//     cae sobre esta ficha en vez de crear una segunda;
//   - se busca colisión por código y por nombre en TODO el sistema, no solo en
//     la sucursal, porque el código es único global y la ingesta busca así;
//   - la sucursal NO se elige: sale del gestor, exactamente igual que en la
//     ingesta. Si se pudiera poner a mano, la siguiente importación la
//     sobrescribiría con la del gestor y quedarían dos verdades.
router.post('/', async (req, res) => {
  try {
    const requester = getRequesterContext(req);

    // Ocultar el botón en la pantalla no es protección: la comprobación va aquí.
    if (!requester.puedeGestionarVendedores) {
      return res.status(403).json({ error: 'No tienes permiso para crear vendedores.' });
    }

    const { nombre: nombreCrudo, codigo: codigoCrudo, gestorId } = req.body as {
      nombre?: string;
      codigo?: string;
      gestorId?: string;
    };

    const nombre = nombreComparable(typeof nombreCrudo === 'string' ? nombreCrudo : '');
    if (nombre.length < 3) {
      return res.status(400).json({ error: 'El nombre del vendedor es obligatorio.' });
    }
    // Nombre y apellido: el código se forma con los dos, y con una sola palabra
    // sale un código que chocará con el primer homónimo que aparezca.
    if (!/\s/.test(nombre)) {
      return res.status(400).json({ error: 'Pon el nombre completo (nombre y apellidos).' });
    }

    // Si no lo escriben, se genera con la MISMA regla que usa el CSV.
    const { codigo, error: errorCodigo } = normalizarCodigoManual(
      (typeof codigoCrudo === 'string' && codigoCrudo.trim()) || codigoDesdeNombre(nombre),
    );
    if (errorCodigo) return res.status(400).json({ error: errorCodigo });

    // El gestor es obligatorio: de él sale la sucursal. Sin gestor el vendedor
    // nacería "Sin asignar" y sus pedidos quedarían OCULTOS — que es justo lo
    // contrario de lo que se busca al darlo de alta a mano.
    if (!gestorId) {
      return res.status(400).json({ error: 'Elige el gestor al que pertenece el vendedor.' });
    }

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
    // Quien no es Super Admin solo da de alta en SU sucursal.
    if (!requester.isGlobalAdmin && gestor.sucursalId !== requester.sucursalId) {
      return res.status(403).json({ error: 'Ese gestor es de otra sucursal.' });
    }

    // Colisión por CÓDIGO (único global) y por NOMBRE (así lo busca la ingesta
    // cuando el código no aparece). Se mira ANTES de crear para poder decir con
    // quién choca: el error de la base solo diría "clave duplicada".
    const [porCodigo, porNombre] = await Promise.all([
      prisma.vendedor.findUnique({
        where: { codigo },
        include: { sucursal: { select: { nombre: true } } },
      }),
      prisma.vendedor.findFirst({
        where: { nombre: { equals: nombre, mode: 'insensitive' } },
        include: { sucursal: { select: { nombre: true } } },
      }),
    ]);

    const choque = porCodigo ?? porNombre;
    if (choque) {
      const donde = choque.sucursal?.nombre ? ` en ${choque.sucursal.nombre}` : ' sin sucursal';
      const motivo = porCodigo
        ? `El código '${codigo}' ya es de '${choque.nombre}'${donde}.`
        : `Ya existe '${choque.nombre}'${donde}.`;

      return res.status(409).json({
        error:
          `${motivo} No se creó nada: si es la misma persona, enlázala desde esta ` +
          `misma vista en vez de crearla otra vez. Si es otra, el código tiene que ser distinto.`,
        vendedorExistente: { id: choque.id, nombre: choque.nombre, codigo: choque.codigo },
      });
    }

    let vendedor;
    try {
      vendedor = await prisma.vendedor.create({
        data: {
          nombre,
          codigo,
          gestorId: gestor.id,
          sucursalId: gestor.sucursalId,
          activo: true,
          creadoPor: requester.username ?? null,
        },
      });
    } catch (e) {
      // Dos altas a la vez con el mismo código: la comprobación de arriba pasó en
      // las dos y la base para a la segunda. Se traduce a un mensaje entendible
      // en vez de un 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return res.status(409).json({ error: 'Ese vendedor acaba de crearse. Recarga la lista.' });
      }
      throw e;
    }

    await emitirVendedor(vendedor.id, 'create');
    res.status(201).json(vendedor);
  } catch (error) {
    console.error('Error creating vendedor:', error);
    res.status(500).json({ error: 'Error al crear el vendedor' });
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
        //
        // El `sucursalId: null` va EXPLÍCITO y no se puede quitar. Antes esto
        // era `NOT: { sucursalId }`, que en SQL se traduce a
        // `"sucursalId" <> 'X'` — y comparar NULL con algo no da verdadero, da
        // DESCONOCIDO. Resultado: los pedidos sin sucursal, que son justo los
        // que este backfill viene a arreglar, eran los únicos que se saltaba.
        //
        // No falla ruidosamente: el pedido se queda sin sucursal, invisible en
        // la vista y IMPOSIBLE de completar, sin que nada avise. Se descubrió el
        // 07/08/2026 con 3 pedidos de Raúl Salgado que llevaban días así
        // mientras otros 11 suyos estaban bien.
        const p = await tx.pedido.updateMany({
          where: {
            vendedorId: id,
            OR: [{ sucursalId: null }, { sucursalId: { not: sucursalId } }],
          },
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

    // Uso del portapapeles de ESTE vendedor: el registro que se le lleva.
    //
    // Va aparte del filtro de año a propósito. Lo demás son pedidos, que existen
    // desde siempre; esto se empezó a medir el 06/08/2026, así que partirlo por
    // años enseñaría ceros en 2025 como si nadie hubiera copiado nada — cuando
    // lo que pasa es que aún no se contaba. Por eso se devuelve el total y la
    // fecha desde la que hay medición, para poder decirlo en pantalla.
    const [uso] = await prisma.$queryRaw<
      Array<{
        copias_pedido: bigint;
        pedidos_copiados: bigint;
        copias_vendedor: bigint;
        ultima: Date | null;
      }>
    >(Prisma.sql`
      select count(*) filter (where tipo = 'pedido')                   as copias_pedido,
             -- DISTINTOS: si a un pedido se le copia el código tres veces
             -- (porque se reintentó la factura), son 3 copias pero 1 pedido.
             -- Mezclarlos daría una cobertura mayor que la real.
             count(distinct "pedidoId") filter (where tipo = 'pedido')  as pedidos_copiados,
             count(*) filter (where tipo = 'vendedor')                  as copias_vendedor,
             max((("creada" at time zone 'UTC') at time zone 'America/Havana')) as ultima
        from "ClipboardCopy"
       where "vendedorId" = ${id}
    `);

    // Quién le copia los códigos. Son varias operadoras y cada una factura lo
    // suyo: sin esto, un número alto no dice si lo lleva una sola persona.
    const quien = await prisma.$queryRaw<Array<{ username: string | null; copias: bigint }>>(
      Prisma.sql`
        select username, count(*) as copias
          from "ClipboardCopy"
         where "vendedorId" = ${id}
         group by 1
         order by 2 desc
         limit 5
      `,
    );

    const [medicion] = await prisma.$queryRaw<Array<{ desde: Date | null }>>(Prisma.sql`
      select min((("creada" at time zone 'UTC') at time zone 'America/Havana')) as desde
        from "ClipboardCopy"
    `);

    const num = (v: bigint | null | undefined) => Number(v ?? 0);

    res.json({
      totalPedidos,
      pedidosCompletados,
      pedidosEnProceso,
      pedidosExpirados,
      availableYears: years,
      portapapeles: {
        copiasPedido: num(uso?.copias_pedido),
        pedidosCopiados: num(uso?.pedidos_copiados),
        copiasVendedor: num(uso?.copias_vendedor),
        ultima: uso?.ultima ?? null,
        medidoDesde: medicion?.desde ?? null,
        quien: quien.map((q) => ({ username: q.username ?? '(sin usuario)', copias: num(q.copias) })),
      },
    });
  } catch (error) {
    console.error('Error fetching vendedor stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas del vendedor' });
  }
});

export default router;
