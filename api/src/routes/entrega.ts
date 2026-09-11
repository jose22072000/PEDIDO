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
  const filas = await prisma.entregaIntento.findMany({
    where: { ultimoAt: { gte: desde } },
    orderBy: [{ ok: 'asc' }, { intentos: 'desc' }],
    take: 300,
  });

  // Una sola consulta para todos los folios, no una por fila: son hasta 300.
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

  const salida = filas.map((f) => {
    const p = porFolio.get(f.folio) ?? null;
    const clase = f.ok
      ? 'aplicada'
      : !p
        ? 'no_subido'
        : p.requiere_domicilio === false
          ? 'sin_domicilio'
          : 'otro';

    return {
      folio: f.folio,
      motivo: f.motivo,
      ok: f.ok,
      clase,
      intentos: f.intentos,
      cliente: f.cliente,
      vendedorMandado: f.vendedor,
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

  const cuenta = (c: string) => salida.filter((s) => s.clase === c).length;

  res.json({
    desde,
    resumen: {
      folios: salida.length,
      aplicadas: cuenta('aplicada'),
      no_subido: cuenta('no_subido'),
      sin_domicilio: cuenta('sin_domicilio'),
      otro: cuenta('otro'),
      // Lo que de verdad duele: cuántas veces se ha reintentado en balde.
      reintentos_en_balde: salida.filter((s) => !s.ok).reduce((n, s) => n + s.intentos, 0),
    },
    intentos: salida,
  });
});


export default router;
