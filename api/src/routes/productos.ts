import { Router } from 'express';
import prisma from '../prismaClient';
import { serviceAuth } from '../middleware/serviceAuth';
import { sondearUnaVez } from '../lib/sondeoVentra';

/**
 * El catálogo por sucursal: precio, existencias y peso.
 *
 * Sale de la copia local que el sondeo trae de Ventra, no de Ventra en directo: si se
 * preguntara al vuelo, un corte de VPN dejaría estas pantallas en blanco. Aquí, un
 * corte solo significa que `traidoAt` se va quedando viejo — y eso se ve.
 */
const router = Router();
router.use(serviceAuth);

/**
 * GET /productos?sucursalCodigo=CAM&buscar=arroz&soloConStock=1&limit=500
 * Para la APK y para quien quiera el catálogo de una sucursal.
 */
router.get('/', async (req, res) => {
  try {
    const codigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';
    const buscar = typeof req.query.buscar === 'string' ? req.query.buscar.trim() : '';
    const soloConStock = req.query.soloConStock === '1' || req.query.soloConStock === 'true';
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);

    const filas = await prisma.productoSucursal.findMany({
      where: {
        ...(codigo ? { sucursal: { codigo } } : {}),
        ...(buscar ? { nombre: { contains: buscar, mode: 'insensitive' } } : {}),
        ...(soloConStock ? { stock: { gt: 0 } } : {}),
        activo: true,
      },
      orderBy: [{ nombre: 'asc' }],
      take: limit,
      include: { sucursal: { select: { codigo: true, nombre: true } } },
    });

    res.json({
      count: filas.length,
      productos: filas.map((f) => ({
        sku: f.sku, nombre: f.nombre, categoria: f.categoria, unidad: f.unidad,
        pesoKg: f.pesoKg, stock: f.stock, precio: f.precio,
        sucursalCodigo: f.sucursal?.codigo ?? null,
        sucursalNombre: f.sucursal?.nombre ?? null,
        // De cuándo es este dato. Si se queda viejo, la VPN al almacén está caída.
        traidoAt: f.traidoAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo leer el catálogo' });
  }
});

/**
 * POST /productos/sondear — traer el catálogo de Ventra AHORA, sin esperar la media
 * hora. Sirve para comprobar que la VPN y el token están bien sin mirar registros.
 *
 * Es lectura de Ventra y escritura AQUÍ: en el almacén no se toca nada.
 */
router.post('/sondear', async (_req, res) => {
  try {
    const r = await sondearUnaVez();
    res.json({ sucursales: r });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
