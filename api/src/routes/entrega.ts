import { Router } from 'express';
import { NextFunction, Response } from 'express';
import prisma from '../prismaClient';
import { getRequesterContext } from '../lib/sucursalContext';
import { authenticateToken, AuthRequest } from '../middleware/auth';

/**
 * Lo que la APK de Entrega intenta meter, para mirarlo desde el panel.
 *
 * # Por qué en su propio router y no en el de webhooks
 *
 * `/webhooks` es público a propósito: lo llama la APK con su clave y su firma, sin sesión.
 * Colgar de ahí una pantalla de consulta habría dejado a la vista de cualquiera los folios
 * y los nombres de los clientes. Esto es del panel, así que va con la sesión y con el
 * mismo candado que Configuración.
 */
const router = Router();

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!getRequesterContext(req).canManageUsers) {
    return res.status(403).json({ error: 'Solo los administradores pueden ver los envíos de Entrega.' });
  }
  next();
};

router.use(authenticateToken, requireAdmin);

/**
 * GET /webhooks/entrega/intentos
 *
 * Lo que la APK de Entrega está intentando meter y cómo va, para verlo desde el panel sin
 * entrar al servidor.
 *
 * # Lo que responde, y por qué esas tres cosas
 *
 * Cada folio que falla cae en uno de tres sitios, y cada uno se arregla en un lado
 * distinto. Distinguirlos es TODO el valor de esta pantalla:
 *
 * - `no_subido`  — el pedido no está en PEDIDO. El repartidor entrega el mismo día y el
 *                  vendedor sube su archivo después, así que al principio es normal y se
 *                  arregla solo. Si lleva más de un día, es que nadie lo ha subido.
 * - `sin_domicilio` — el pedido existe y NO va a domicilio. Se rechaza siempre; reintentar
 *                  no sirve de nada. Es un fallo de la APK, que no debería cobrarlo.
 * - `otro`       — cualquier otra cosa: folio ambiguo, costo inválido, etc.
 *
 * La clasificación se calcula AQUÍ y no se guarda, porque cambia sola: un folio que hoy es
 * `no_subido` deja de serlo en cuanto el vendedor suba su archivo. Guardarla sería tener
 * una foto vieja de algo que ya no es verdad.
 */
router.get('/intentos', async (req, res) => {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  /**
   * Se traen TODAS las filas de la ventana y se pagina después de clasificar.
   *
   * Paginar en la consulta sería lo natural, pero la clase de cada fila no está guardada:
   * se calcula cruzando con el pedido, porque cambia sola —un folio «no subido» deja de
   * serlo en cuanto el vendedor sube su archivo—. Paginando antes, los contadores de
   * arriba contarían sólo la página que se está mirando, y el filtro por clase se saltaría
   * filas que están en otra página.
   *
   * El tope de 2.000 es de sobra: son filas agrupadas por (folio, código), no una por
   * llamada. Con 25 folios fallando al día, siete días son unas 200.
   */
  const filas = await prisma.entregaIntento.findMany({
    where: { ultimoAt: { gte: desde } },
    take: 2000,
  });

  // Una sola consulta para todos los folios, no una por fila.
  const folios = [...new Set(filas.map((f) => f.folio))].filter((f) => f !== '(sin folio)');
  const pedidos = folios.length
    ? await prisma.pedido.findMany({
        where: { OR: folios.map((f) => ({ folio: { startsWith: f } })) },
        select: { folio: true, requiere_domicilio: true, fecha: true, createdAt: true,
                  cliente: { select: { nombre: true } },
                  // El vendedor es lo que hace la fila identificable de un vistazo: el
                  // folio lleva sus iniciales dentro, y hay seis prefijos que comparten
                  // dos vendedores (PDG26 es Dayana González y Diango Gola).
                  vendedor: { select: { nombre: true, codigo: true } },
                  sucursal: { select: { codigo: true } } },
      })
    : [];

  const porFolio = new Map<string, (typeof pedidos)[number]>();

  for (const p of pedidos) {
    // Se queda el que empieza por el folio mandado: el exacto, o el que sólo le añade
    // nuestro sufijo. `startsWith` a secas metería `-1130` detrás de `-1`.
    for (const f of folios) {
      const resto = p.folio.slice(f.length);

      if (p.folio.startsWith(f) && (resto === '' || /^-\d{1,2}$/.test(resto)) && !porFolio.has(f)) {
        porFolio.set(f, p);
      }
    }
  }

  const todos = filas.map((f) => {
    const p = porFolio.get(f.folio) ?? null;
    /**
     * La clase que se enseña sale de CRUZAR el código con lo que hay ahora en la base.
     *
     * El código dice qué contestamos entonces; el pedido dice qué hay ahora. Un folio que
     * se rechazó por «no encontrado» y que mientras tanto se ha subido deja de ser un
     * problema, y esta pantalla tiene que enseñar lo de ahora, no lo de hace dos horas.
     */
    const clase = f.ok
      ? 'aplicada'
      : !p
        ? 'no_subido'
        : p.requiere_domicilio === false
          ? 'sin_domicilio'
          : f.codigo === 'ambiguo'
            ? 'ambiguo'
            : 'otro';

    return {
      folio: f.folio,
      motivo: f.motivo,
      codigo: f.codigo,
      ok: f.ok,
      clase,
      intentos: f.intentos,
      cliente: f.cliente,
      vendedorMandado: f.vendedor,
      campos: f.campos,
      primeroAt: f.primeroAt,
      ultimoAt: f.ultimoAt,
      // Lo que tenemos nosotros de ese folio, para poder comparar de un vistazo.
      nuestro: p
        ? { folio: p.folio, cliente: p.cliente?.nombre ?? null, fecha: p.fecha,
            creadoAt: p.createdAt, requiereDomicilio: p.requiere_domicilio,
            vendedor: p.vendedor?.nombre ?? p.vendedor?.codigo ?? null,
            sucursal: p.sucursal?.codigo ?? null }
        : null,
    };
  });

  const cuenta = (c: string) => todos.filter((s) => s.clase === c).length;

  /**
   * El resumen se calcula sobre TODO, nunca sobre la página ni sobre el filtro.
   *
   * Son las tarjetas con las que se filtra: si contaran lo filtrado, al pulsar una se
   * quedaría en uno y las demás en cero, y ya no se podría volver.
   */
  const resumen = {
    folios: todos.length,
    aplicadas: cuenta('aplicada'),
    no_subido: cuenta('no_subido'),
    sin_domicilio: cuenta('sin_domicilio'),
    ambiguo: cuenta('ambiguo'),
    otro: cuenta('otro'),
    // Lo que de verdad duele: cuántas veces se ha reintentado en balde.
    reintentos_en_balde: todos.filter((s) => !s.ok).reduce((n, s) => n + s.intentos, 0),
  };

  // --- filtro, orden y página
  const clase = typeof req.query.clase === 'string' ? req.query.clase.trim() : '';
  const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().toLowerCase();
  const orden = req.query.orden === 'reciente' ? 'reciente' : 'intentos';
  const porPagina = Math.min(Math.max(Number(req.query.porPagina) || 20, 5), 100);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);

  let lista = clase ? todos.filter((t) => t.clase === clase) : todos;

  if (q) {
    // Se busca por lo que uno tiene delante cuando pregunta: el folio que le dio el
    // repartidor, o el nombre del cliente o del vendedor.
    lista = lista.filter((t) =>
      [t.folio, t.nuestro?.folio, t.nuestro?.cliente, t.nuestro?.vendedor, t.nuestro?.sucursal, t.cliente]
        .some((v) => (v ?? '').toString().toLowerCase().includes(q)),
    );
  }

  lista = [...lista].sort((a, b) =>
    orden === 'reciente'
      ? new Date(b.ultimoAt).getTime() - new Date(a.ultimoAt).getTime()
      // Por defecto, lo que más está machacando: primero lo que no entra, y dentro de eso
      // lo que más veces se ha reintentado.
      : Number(a.ok) - Number(b.ok) || b.intentos - a.intentos,
  );

  const total = lista.length;
  const paginas = Math.max(Math.ceil(total / porPagina), 1);
  const actual = Math.min(pagina, paginas);

  res.json({
    desde,
    resumen,
    filtro: { clase, q, orden },
    pagina: { actual, paginas, porPagina, total },
    intentos: lista.slice((actual - 1) * porPagina, actual * porPagina),
  });
});

export default router;
