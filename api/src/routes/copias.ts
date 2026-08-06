import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import { authenticateToken } from '../middleware/auth';
import { getRequesterContext, resolveSucursalFilter } from '../lib/sucursalContext';

const router = express.Router();

// TODO el router exige sesión. Sin esto, cualquiera desde fuera podría meter
// filas: el contador es un NÚMERO QUE SE VA A MIRAR para decidir si una sucursal
// está usando el sistema o no, así que uno inflado es peor que no tenerlo —
// llevaría a dar por bueno un trabajo que no se está haciendo.
router.use(authenticateToken);

const TIPOS = ['pedido', 'vendedor', 'cliente'] as const;
type Tipo = (typeof TIPOS)[number];

/**
 * POST /copias   body: { tipo, pedidoId?, vendedorId?, clienteId? }
 *
 * Registra que alguien copió algo al portapapeles. Lo llama la pantalla justo
 * después de copiar, sin esperar respuesta.
 *
 * Dos decisiones que parecen detalles y no lo son:
 *
 *  - **Nunca falla hacia fuera.** Si esto diera error, la pantalla tendría que
 *    decidir si avisa de que "no se pudo registrar la copia" — y el texto YA
 *    está en el portapapeles, así que el trabajo salió bien. Un aviso de error
 *    ahí solo confunde a quien está facturando. Se responde 204 pase lo que
 *    pase y el fallo se anota en el log del servidor.
 *  - **No comprueba que el pedido exista.** Sería una consulta más por cada
 *    clic para no ganar nada: si el id no existe, la fila queda con un id que no
 *    apunta a ningún sitio y los conteos por pedido sencillamente no la cuentan.
 */
router.post('/', async (req, res) => {
  try {
    const { tipo, pedidoId, vendedorId, clienteId } = req.body as {
      tipo?: string;
      pedidoId?: string;
      vendedorId?: string;
      clienteId?: string;
    };

    if (!TIPOS.includes(tipo as Tipo)) {
      return res.status(400).json({ error: `tipo tiene que ser uno de: ${TIPOS.join(', ')}` });
    }

    const { userId, username, sucursalId } = getRequesterContext(req);

    await prisma.copiaPortapapeles.create({
      data: {
        tipo: tipo as Tipo,
        pedidoId: pedidoId || null,
        vendedorId: vendedorId || null,
        clienteId: clienteId || null,
        usuarioId: userId ?? null,
        username: username ?? null,
        sucursalId: sucursalId ?? null,
      },
    });

    res.status(204).end();
  } catch (error) {
    console.error('Error registrando copia al portapapeles:', error);
    // A propósito 204: lo importante (copiar) ya pasó en el navegador.
    res.status(204).end();
  }
});

/**
 * GET /copias/resumen?desde=&hasta=
 *
 * Cuántas veces se ha usado el portapapeles. El total, partido por tipo, por
 * sucursal, por persona y por día.
 *
 * El número que se busca es el de tipo `pedido`: es el que se pega en la
 * observación de la factura, o sea el uso real en el sistema de facturación. Los
 * otros dos se cuentan aparte para no inflarlo.
 */
router.get('/resumen', async (req, res) => {
  try {
    const { sucursalId, error } = resolveSucursalFilter(req);
    if (error) return res.status(400).json({ error });

    const desde = req.query.desde ? new Date(String(req.query.desde)) : null;
    const hasta = req.query.hasta ? new Date(String(req.query.hasta)) : null;

    if ((desde && isNaN(desde.getTime())) || (hasta && isNaN(hasta.getTime()))) {
      return res.status(400).json({ error: 'Fechas inválidas.' });
    }

    // El Super Admin sin sucursal enfocada ve TODO (sucursalId undefined ->
    // Prisma ignora el filtro), igual que en el resto de las vistas.
    const where = {
      ...(sucursalId ? { sucursalId } : {}),
      ...(desde || hasta
        ? {
            creada: {
              ...(desde ? { gte: desde } : {}),
              // `hasta` se entiende como el día COMPLETO: sin esto, pedir hasta
              // el día 5 dejaría fuera todo lo copiado ese día salvo lo de las
              // 00:00, que es un error que no se ve, solo da de menos.
              ...(hasta ? { lt: new Date(hasta.getTime() + 24 * 60 * 60 * 1000) } : {}),
            },
          }
        : {}),
    };

    const [total, porTipo, porUsuario, porSucursal] = await Promise.all([
      prisma.copiaPortapapeles.count({ where }),
      prisma.copiaPortapapeles.groupBy({ by: ['tipo'], where, _count: { _all: true } }),
      prisma.copiaPortapapeles.groupBy({
        by: ['username'],
        where,
        _count: { _all: true },
        orderBy: { _count: { username: 'desc' } },
        take: 25,
      }),
      prisma.copiaPortapapeles.groupBy({ by: ['sucursalId'], where, _count: { _all: true } }),
    ]);

    // Por día: en SQL, porque agrupar por FECHA (no por instante) no se puede
    // expresar con el groupBy de Prisma. Los filtros se componen con Prisma.sql
    // para que sigan siendo parámetros y no texto pegado a la consulta.
    const condiciones = [
      sucursalId ? Prisma.sql`"sucursalId" = ${sucursalId}` : null,
      desde ? Prisma.sql`"creada" >= ${desde}` : null,
      hasta ? Prisma.sql`"creada" < ${new Date(hasta.getTime() + 24 * 60 * 60 * 1000)}` : null,
    ].filter((c): c is Prisma.Sql => c !== null);

    const porDia = await prisma.$queryRaw<Array<{ dia: Date; copias: bigint }>>(Prisma.sql`
      select date_trunc('day', "creada") as dia, count(*) as copias
        from "ClipboardCopy"
       ${condiciones.length ? Prisma.sql`where ${Prisma.join(condiciones, ' and ')}` : Prisma.empty}
       group by 1
       order by 1 desc
       limit 60
    `);

    const nombres = await prisma.sucursal.findMany({ select: { id: true, nombre: true } });
    const nombrePorId = new Map(nombres.map((s) => [s.id, s.nombre]));

    res.json({
      total,
      // El que de verdad mide el uso en facturación.
      pedidos: porTipo.find((t) => t.tipo === 'pedido')?._count._all ?? 0,
      porTipo: Object.fromEntries(porTipo.map((t) => [t.tipo, t._count._all])),
      porUsuario: porUsuario
        .filter((u) => u.username)
        .map((u) => ({ username: u.username, copias: u._count._all })),
      porSucursal: porSucursal.map((s) => ({
        sucursalId: s.sucursalId,
        nombre: s.sucursalId ? (nombrePorId.get(s.sucursalId) ?? 'Desconocida') : 'Sin sucursal',
        copias: s._count._all,
      })),
      porDia: porDia.map((d) => ({ dia: d.dia, copias: Number(d.copias) })),
    });
  } catch (error) {
    console.error('Error en el resumen de copias:', error);
    res.status(500).json({ error: 'Error al obtener el resumen de copias' });
  }
});

export default router;
