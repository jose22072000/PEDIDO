import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import { authenticateToken } from '../middleware/auth';
import { getRequesterContext, resolveSucursalFilter } from '../lib/sucursalContext';
import { parsearFechaConsulta } from '../lib/fechaConsulta';

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
 * Cuántas veces se ha usado el portapapeles: el total, y partido por tipo, por
 * sucursal, por persona, por día y POR PERSONA Y DÍA.
 *
 * El número que se busca es el de tipo `pedido`: es el que se pega en la
 * observación de la factura, o sea el uso real en el sistema contable. Los otros
 * dos se cuentan aparte para no inflarlo.
 *
 * **Por qué el cruce persona × día.** Esto no lo usa una persona: lo usan varias
 * operadoras, cada una en su sucursal. Un total suelto ("van 8000") no dice si
 * lo usan todas o solo una, ni si alguien dejó de usarlo el martes. Con el cruce
 * se ve quién lo usa, desde cuándo y quién lo dejó.
 *
 * **Todo va en hora de Cuba.** El servidor y Postgres están en UTC, y Cuba va
 * cuatro horas por detrás: agrupando por día en UTC, todo lo copiado a partir de
 * las 8 de la noche se contaría en el día SIGUIENTE. Un informe de "cuándo" con
 * los días corridos no vale para nada, y el error no se ve — solo mueve trabajo
 * de un día al otro. Por eso los días y las horas se calculan con
 * `America/Havana`, que además arregla solo el cambio de horario.
 */
const ZONA = 'America/Havana';

// El instante guardado (UTC) llevado a la hora de Cuba. Se repite en cada
// consulta, así que se escribe una vez.
const DIA_CUBA = Prisma.sql`(("creada" at time zone 'UTC') at time zone ${ZONA})`;

router.get('/resumen', async (req, res) => {
  try {
    const { sucursalId, error } = resolveSucursalFilter(req);
    if (error) return res.status(400).json({ error });

    // Las mismas comprobaciones que el resto de la aplicación: una fecha
    // ilegible tiene que dar un mensaje claro, no una consulta rota.
    const desde = parsearFechaConsulta(req.query.desde, 'desde');
    const hasta = parsearFechaConsulta(req.query.hasta, 'hasta');

    if (desde.error || hasta.error) {
      return res.status(400).json({ error: desde.error || hasta.error });
    }

    // Los límites se comparan contra el DÍA de Cuba, no contra el instante: así
    // "desde el 6" es el día 6 en Cuba, que es lo que espera quien lo pide.
    const condiciones = [
      sucursalId ? Prisma.sql`"sucursalId" = ${sucursalId}` : null,
      desde.fecha ? Prisma.sql`${DIA_CUBA}::date >= ${desde.fecha}::date` : null,
      hasta.fecha ? Prisma.sql`${DIA_CUBA}::date <= ${hasta.fecha}::date` : null,
    ].filter((c): c is Prisma.Sql => c !== null);

    const filtro = condiciones.length
      ? Prisma.sql`where ${Prisma.join(condiciones, ' and ')}`
      : Prisma.empty;

    const [porTipo, porSucursal, porUsuario, porDia, porUsuarioDia, porHora] = await Promise.all([
      prisma.$queryRaw<Array<{ tipo: string; copias: bigint }>>(Prisma.sql`
        select tipo, count(*) as copias from "ClipboardCopy" ${filtro} group by 1
      `),

      prisma.$queryRaw<Array<{ sucursalId: string | null; copias: bigint }>>(Prisma.sql`
        select "sucursalId", count(*) as copias from "ClipboardCopy" ${filtro} group by 1
      `),

      // Por persona: cuántas lleva, cuántas de ellas son códigos de pedido (las
      // que cuentan como uso real), en cuántos días distintos y cuándo fue la
      // última. "Cuántos días" separa a quien lo usa a diario de quien lo probó
      // una tarde y no volvió — dos casos que en un total suelto se ven igual.
      prisma.$queryRaw<
        Array<{
          username: string | null;
          copias: bigint;
          pedidos: bigint;
          dias: bigint;
          ultima: Date | null;
        }>
      >(Prisma.sql`
        select username,
               count(*)                                    as copias,
               count(*) filter (where tipo = 'pedido')     as pedidos,
               count(distinct ${DIA_CUBA}::date)           as dias,
               max(${DIA_CUBA})                            as ultima
          from "ClipboardCopy"
          ${filtro}
         group by 1
         order by 2 desc
      `),

      prisma.$queryRaw<Array<{ dia: Date; copias: bigint; pedidos: bigint }>>(Prisma.sql`
        select ${DIA_CUBA}::date                       as dia,
               count(*)                                as copias,
               count(*) filter (where tipo = 'pedido') as pedidos
          from "ClipboardCopy"
          ${filtro}
         group by 1
         order by 1 desc
         limit 90
      `),

      // El cruce: qué día hizo cuántas cada persona.
      prisma.$queryRaw<Array<{ dia: Date; username: string | null; copias: bigint }>>(Prisma.sql`
        select ${DIA_CUBA}::date as dia, username, count(*) as copias
          from "ClipboardCopy"
          ${filtro}
         group by 1, 2
         order by 1 desc
         limit 1000
      `),

      // A qué hora del día se usa. Contesta literalmente "cuándo lo hace": si el
      // trabajo se concentra en la mañana, si hay quien factura de noche.
      prisma.$queryRaw<Array<{ hora: number; copias: bigint }>>(Prisma.sql`
        select extract(hour from ${DIA_CUBA})::int as hora, count(*) as copias
          from "ClipboardCopy"
          ${filtro}
         group by 1
         order by 1
      `),
    ]);

    const nombres = await prisma.sucursal.findMany({ select: { id: true, nombre: true } });
    const nombrePorId = new Map(nombres.map((s) => [s.id, s.nombre]));

    const n = (v: bigint | null) => Number(v ?? 0);
    const tipos = Object.fromEntries(porTipo.map((t) => [t.tipo, n(t.copias)]));

    res.json({
      zona: ZONA,
      total: porTipo.reduce((s, t) => s + n(t.copias), 0),
      // El que de verdad mide el uso en facturación.
      pedidos: tipos.pedido ?? 0,
      porTipo: tipos,
      porSucursal: porSucursal.map((s) => ({
        sucursalId: s.sucursalId,
        nombre: s.sucursalId ? (nombrePorId.get(s.sucursalId) ?? 'Desconocida') : 'Sin sucursal',
        copias: n(s.copias),
      })),
      porUsuario: porUsuario.map((u) => ({
        username: u.username ?? '(sin usuario)',
        copias: n(u.copias),
        pedidos: n(u.pedidos),
        dias: n(u.dias),
        ultima: u.ultima,
      })),
      porDia: porDia.map((d) => ({
        dia: d.dia,
        copias: n(d.copias),
        pedidos: n(d.pedidos),
      })),
      porUsuarioDia: porUsuarioDia.map((x) => ({
        dia: x.dia,
        username: x.username ?? '(sin usuario)',
        copias: n(x.copias),
      })),
      porHora: porHora.map((h) => ({ hora: h.hora, copias: n(h.copias) })),
    });
  } catch (error) {
    console.error('Error en el resumen de copias:', error);
    res.status(500).json({ error: 'Error al obtener el resumen de copias' });
  }
});

export default router;
