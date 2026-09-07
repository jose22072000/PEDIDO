import { Router } from 'express';

import prisma from '../prismaClient';
import { estadoDeFactura, HORA_CORTE, type EstadoFactura } from '../lib/corteFacturacion';
import { leerUltimaPasada } from '../lib/cotejoEstado';
import { extremosDelDia, hoyEnCuba } from '../lib/diaCubano';
import { getRequesterContext, resolveSucursalFilter } from '../lib/sucursalContext';

/**
 * La vista del SINCRONIZADOR de facturación: qué se cotejó, qué cuadró y qué no.
 *
 * # Por qué hace falta una pantalla para esto
 *
 * «Completado» y «facturado» son cosas distintas y en la lista de pedidos se veían igual.
 * El 07/09/2026, de los 148 pedidos del día anterior sólo 10 tenían factura en Ventra. Los
 * otros 138 podían estar en tres situaciones que desde fuera no se distinguen:
 *
 *   1. Todavía no se ha facturado. El día 6 fue domingo: La Habana facturó cero líneas ese
 *      día y treinta y ocho el viernes. Se factura al día siguiente, y eso es normal.
 *   2. Se facturó y NO se pegó el folio en la nota. El folio lo copia y lo pega una
 *      persona al facturar en Ventra, así que aquí es donde se pierde de verdad.
 *   3. Se pegó mal.
 *
 * # UN DÍA CADA VEZ, Y PAGINADO
 *
 * La primera versión enseñaba siete días de golpe y todos los pedidos sin factura de esos
 * siete días en una tabla sin fin. Era ilegible: se abría, salían cientos de filas de
 * todos los días mezcladas, y no se distinguía lo de hoy —lo que está pasando ahora— de lo
 * de la semana pasada.
 *
 * Ahora se pide UN día, y por defecto el de hoy. La lista va aparte y paginada, con
 * buscador y filtros. Lo de otros días sigue estando: se cambia la fecha.
 *
 * # Y NO le pregunta nada a Ventra
 *
 * Todo sale de nuestra base y de Redis. El cotejo ya corre en el worker cada diez minutos y
 * deja ahí el resultado de su última pasada; la pantalla lo lee. Si sondeara, abrirla ocho
 * veces serían ochenta consultas por la VPN, y el trabajo de fondo pasaría a depender de
 * que alguien tenga una pestaña abierta.
 */
const router = Router();

/**
 * Esto no es para el Operador, igual que los informes: es una pantalla de control, y quien
 * sube pedidos no tiene por qué ver el estado de la facturación de la sucursal entera.
 * Se comprueba una vez para todo el router, para que una ruta nueva nazca protegida.
 */
router.use((req, res, next) => {
  if (!getRequesterContext(req).puedeImportarYReportar) {
    return res.status(403).json({ error: 'Tu usuario no puede ver el estado de la facturación.' });
  }

  return next();
});

const ESTADOS: EstadoFactura[] = [
  'facturado', 'cambiado', 'buscando', 'no_aparecio', 'sin_completar', 'sin_cotejar',
];

/**
 * El RESUMEN de un día: los totales y el desglose por sucursal. Nada de listas.
 *
 * Va aparte de los pedidos a propósito. Es lo primero que se pinta —y lo único que hace
 * falta para saber si el día va bien— así que tiene que llegar sin esperar a una tabla de
 * cientos de filas.
 */
router.get('/resumen', async (req, res) => {
  const { sucursalId, error, status } = resolveSucursalFilter(req);

  if (error) return res.status(status ?? 400).json({ error });

  const dia = typeof req.query.dia === 'string' && req.query.dia ? req.query.dia : hoyEnCuba();
  const rango = extremosDelDia(dia);

  if (!rango) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD.' });

  const pedidos = await prisma.pedido.findMany({
    where: {
      fecha: { gte: rango.desde, lte: rango.hasta },
      ...(sucursalId ? { sucursalId } : {}),
    },
    select: {
      fecha: true,
      estado: true,
      facturaEstado: true,
      sucursalId: true,
      sucursal: { select: { nombre: true } },
    },
  });

  const ahora = new Date();
  const vacio = () => ({
    total: 0, facturado: 0, cambiado: 0, buscando: 0,
    no_aparecio: 0, sin_completar: 0, sin_cotejar: 0,
  });
  const totales = vacio();
  const porSucursal = new Map<string, ReturnType<typeof vacio> & { sucursalId: string | null; sucursal: string }>();

  for (const p of pedidos) {
    const est = estadoDeFactura(p.facturaEstado, p.fecha, ahora, p.estado);
    const clave = p.sucursalId ?? '-';
    const fila =
      porSucursal.get(clave) ??
      { ...vacio(), sucursalId: p.sucursalId, sucursal: p.sucursal?.nombre ?? 'sin sucursal' };

    fila.total++;
    fila[est]++;
    porSucursal.set(clave, fila);

    totales.total++;
    totales[est]++;
  }

  return res.json({
    dia,
    hoy: hoyEnCuba(),
    horaCorte: HORA_CORTE,
    totales,
    sucursales: [...porSucursal.values()].sort((a, b) => b.total - a.total),
    ultimaPasada: await leerUltimaPasada(),
  });
});

/**
 * Los PEDIDOS de un día, paginados, con buscador y filtros.
 *
 * Paginado en el servidor y no en la pantalla: un día flojo son veinte pedidos y uno bueno
 * son cuatrocientos. Mandarlos todos para enseñar veinte es gastar el cable y la memoria
 * del navegador en algo que nadie va a mirar.
 */
router.get('/pedidos', async (req, res) => {
  const { sucursalId, error, status } = resolveSucursalFilter(req);

  if (error) return res.status(status ?? 400).json({ error });

  const dia = typeof req.query.dia === 'string' && req.query.dia ? req.query.dia : hoyEnCuba();
  const rango = extremosDelDia(dia);

  if (!rango) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD.' });

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const filtroSucursal = typeof req.query.sucursalId === 'string' ? req.query.sucursalId : '';
  const pedidos = typeof req.query.estado === 'string' && req.query.estado
    ? req.query.estado.split(',').filter((e): e is EstadoFactura => ESTADOS.includes(e as EstadoFactura))
    : [];

  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = Math.min(100, Math.max(5, Number(req.query.porPagina) || 25));

  /**
   * El filtro por estado NO se puede pasar a la consulta tal cual.
   *
   * `buscando` y `no_aparecio` son el MISMO `facturaEstado` en la base —`sin_factura`— y lo
   * que los separa es la hora de corte, que se calcula aquí. Así que a la base se le pide
   * el conjunto de estados guardados que puedan dar los pedidos, y el reparto fino se hace
   * después. Es la única parte que no puede vivir en SQL.
   */
  const guardados = new Set<string | null>();

  for (const e of pedidos) {
    if (e === 'facturado') guardados.add('igual');
    else if (e === 'cambiado') guardados.add('cambiado');
    else if (e === 'buscando' || e === 'no_aparecio' || e === 'sin_completar') guardados.add('sin_factura');
    else guardados.add(null);
  }

  const where = {
    fecha: { gte: rango.desde, lte: rango.hasta },
    ...(sucursalId ? { sucursalId } : filtroSucursal ? { sucursalId: filtroSucursal } : {}),
    ...(guardados.size
      ? {
          OR: [
            ...(guardados.has(null) ? [{ facturaEstado: null }] : []),
            ...([...guardados].filter((g): g is string => g != null).length
              ? [{ facturaEstado: { in: [...guardados].filter((g): g is string => g != null) } }]
              : []),
          ],
        }
      : {}),
    ...(q
      ? {
          AND: [
            {
              OR: [
                { folio: { contains: q, mode: 'insensitive' as const } },
                { facturaNumero: { contains: q, mode: 'insensitive' as const } },
                { cliente: { nombre: { contains: q, mode: 'insensitive' as const } } },
                { vendedor: { nombre: { contains: q, mode: 'insensitive' as const } } },
              ],
            },
          ],
        }
      : {}),
  };

  const filas = await prisma.pedido.findMany({
    where,
    select: {
      id: true,
      folio: true,
      fecha: true,
      estado: true,
      facturaEstado: true,
      facturaNumero: true,
      sucursal: { select: { nombre: true } },
      vendedor: { select: { nombre: true } },
      cliente: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'desc' }, { folio: 'asc' }],
  });

  /**
   * El corte se aplica DESPUÉS de la consulta, así que la página se recorta aquí.
   *
   * Traer el día entero y cortar en memoria es correcto para esto: un día son como mucho
   * unos cientos de pedidos de una sucursal. Paginar en SQL daría páginas descuadradas,
   * porque `buscando` y `no_aparecio` no se distinguen hasta después de mirar la hora.
   */
  const ahora = new Date();
  const conEstado = filas
    .map((p) => ({
      id: p.id,
      folio: p.folio,
      fecha: p.fecha,
      estado: p.estado,
      facturaNumero: p.facturaNumero,
      sucursal: p.sucursal?.nombre ?? 'sin sucursal',
      vendedor: p.vendedor?.nombre ?? null,
      cliente: p.cliente?.nombre ?? null,
      factura: estadoDeFactura(p.facturaEstado, p.fecha, ahora, p.estado),
    }))
    .filter((p) => (pedidos.length ? pedidos.includes(p.factura) : true));

  const desde = (pagina - 1) * porPagina;

  return res.json({
    dia,
    total: conEstado.length,
    pagina,
    porPagina,
    paginas: Math.max(1, Math.ceil(conEstado.length / porPagina)),
    pedidos: conEstado.slice(desde, desde + porPagina),
  });
});

export default router;
