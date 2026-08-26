import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import ordersRouter from './routes/orders';
import authRouter from './routes/auth';
import copiasRouter from './routes/copias';
import usersRouter from './routes/users';
import rolesRouter from './routes/roles';
import sucursalesRouter from './routes/sucursales';
import configRouter from './routes/config';
import vendedoresRouter from './routes/vendedores';
import clientesRouter from './routes/clientes';
import productosRouter from './routes/productos';
import reportsRouter from './routes/reports';
import integrationRouter from './routes/integration';
import geolocalizacionRouter from './routes/geolocalizacion';
import mantenimientoRouter from './routes/mantenimiento';
import eventsRouter from './routes/events';
import prisma from './prismaClient';
import { iniciarArchivadoAutomatico } from './lib/archivador';
import apiKeysRouter from './routes/apiKeys';
import webhooksRouter from './routes/webhooks';
import { sembrarConfigDesdeEntorno } from './lib/webhook';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { observarRespuestas, manejarErrores, estadoSalud } from './middleware/errores';

const app = express();
// Detrás de nginx: confiar en el primer proxy para que req.ip sea la IP real del
// cliente (X-Forwarded-For), no la de nginx — si no, el rate-limit por IP agruparía
// a TODOS bajo una sola clave.
app.set('trust proxy', 1);
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

// Configure CORS from environment variable
const corsOrigin = process.env.CORS_ORIGIN 
  ? (process.env.CORS_ORIGIN === '*' 
      ? true // Allow all origins
      : process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()))
  : true; // Allow all origins if not specified

app.use(cors({
  origin: corsOrigin,
  credentials: true, // Allow cookies to be sent
}));
app.use(cookieParser());
app.use(express.json({
  limit: '50mb',
  verify: (req: any, _res, buf) => {
    if (typeof req.url === 'string' && req.url.startsWith('/webhooks')) req.rawBody = buf;
  },
}));
// Use urlencoded parser for simple form submissions. We avoid a global JSON
// body-parser to keep compatibility with multipart/form-data uploads handled
// via multer on specific routes.
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// (Rate limiting retirado: una sucursal entera comparte UNA IP pública por el CGNAT de
// Starlink, así que un límite por IP bloqueaba a todos con "error de conexión". No se
// pone hasta tener un límite por USUARIO autenticado que no afecte a los compañeros.)

// Multer setup for file uploads. Use per-route middleware like
// `upload.single('file')` or `upload.array('files')` in route handlers.
const upload = multer({ dest: 'uploads/temp' });
app.locals.upload = upload;

app.get('/health', (req, res) => res.json({ ok: true }));

// Identidad por API key (x-api-key) en endpoints de lectura -> otros proyectos consumen
// la data. Debe ir ANTES de los routers para que getRequesterContext ya la tenga.
app.use(apiKeyAuth);

// Vigilancia de 5xx: apunta cada respuesta con error de servidor. Va antes de los
// routers para verlas TODAS, incluidas las que devuelve una ruta a mano.
app.use(observarRespuestas);

// Salud del api: sirve para el healthcheck del contenedor y para mirar de un
// vistazo cuántos 5xx lleva y cuáles fueron los últimos.
app.get('/salud', (_req, res) => res.json(estadoSalud()));

app.use('/auth', authRouter);
app.use('/orders', ordersRouter);
app.use('/users', usersRouter);
app.use('/roles', rolesRouter);
app.use('/sucursales', sucursalesRouter);
app.use('/config', configRouter);
app.use('/vendedores', vendedoresRouter);
app.use('/clientes', clientesRouter);
app.use('/productos', productosRouter);
app.use('/reports', reportsRouter);
app.use('/integration', integrationRouter);
app.use('/geolocalizacion', geolocalizacionRouter);
app.use('/mantenimiento', mantenimientoRouter);
app.use('/api-keys', apiKeysRouter);
app.use('/events', eventsRouter);
app.use('/copias', copiasRouter);
// Entrada de webhooks de terceros (la APK de domicilio). Sin sesión y sin la clave de
// servicio: se autentica por firma, con su propio secret.
app.use('/webhooks', webhooksRouter);

// Manejador final de errores. VA EL ÚLTIMO: recoge lo que revienta dentro de una
// ruta y que hasta ahora tumbaba la petición sin dejar rastro identificable.
app.use(manejarErrores);

// Una promesa rechazada sin capturar mata el proceso en Node moderno. Se registra
// con la misma marca para que el vigilante del servidor la mande por correo, en vez
// de que el contenedor se reinicie en silencio y nadie sepa por qué.
process.on('unhandledRejection', (motivo) => {
  console.error(`PROCOVAR-5XX | 500 | proceso unhandledRejection | ${String(motivo).slice(0, 300)}`);
});
process.on('uncaughtException', (err) => {
  console.error(`PROCOVAR-5XX | 500 | proceso uncaughtException | ${err?.message ?? String(err)}`);
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`API listening on http://0.0.0.0:${port}`);
  try {
    await prisma.$connect();
    console.log('Connected to database');
  } catch (err) {
    console.error('Prisma connect error', err);
  }
  // Archiva completados y expirados-viejos (soft-delete) al inicio y cada hora.
  iniciarArchivadoAutomatico();
  // Y trae de Ventra el catálogo de cada sucursal —precio, existencias y peso— cada
  // media hora. Solo lee: en Ventra no se escribe nada nunca.
  // El sondeo de Ventra ya NO corre aquí: lo hace el worker.
  //
  // La API atiende peticiones de ocho sucursales a la vez; traerse diez catálogos del
  // almacén por VPN y escribirlos es trabajo de fondo que no tiene por qué competir con
  // eso. El worker es otro proceso, en otro contenedor: si el sondeo tarda o se atasca,
  // la aplicación ni se entera.
  //
  // La API sigue LEYENDO la tabla para poner precios, y `POST /productos/sondear` sigue
  // existiendo para forzarlo a mano.
  // Deja la config de los webhooks puesta si viene por entorno y todavía está vacía.
  // No pisa lo que se haya cambiado desde Configuración.
  void sembrarConfigDesdeEntorno();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
