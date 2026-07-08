import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import ordersRouter from './routes/orders';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import rolesRouter from './routes/roles';
import sucursalesRouter from './routes/sucursales';
import configRouter from './routes/config';
import vendedoresRouter from './routes/vendedores';
import clientesRouter from './routes/clientes';
import reportsRouter from './routes/reports';
import integrationRouter from './routes/integration';
import geolocalizacionRouter from './routes/geolocalizacion';
import mantenimientoRouter from './routes/mantenimiento';
import prisma from './prismaClient';

const app = express();
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
app.use(express.json({ limit: '50mb' }));
// Use urlencoded parser for simple form submissions. We avoid a global JSON
// body-parser to keep compatibility with multipart/form-data uploads handled
// via multer on specific routes.
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer setup for file uploads. Use per-route middleware like
// `upload.single('file')` or `upload.array('files')` in route handlers.
const upload = multer({ dest: 'uploads/temp' });
app.locals.upload = upload;

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/orders', ordersRouter);
app.use('/users', usersRouter);
app.use('/roles', rolesRouter);
app.use('/sucursales', sucursalesRouter);
app.use('/config', configRouter);
app.use('/vendedores', vendedoresRouter);
app.use('/clientes', clientesRouter);
app.use('/reports', reportsRouter);
app.use('/integration', integrationRouter);
app.use('/geolocalizacion', geolocalizacionRouter);
app.use('/mantenimiento', mantenimientoRouter);

app.listen(port, '0.0.0.0', async () => {
  console.log(`API listening on http://0.0.0.0:${port}`);
  try {
    await prisma.$connect();
    console.log('Connected to database');
  } catch (err) {
    console.error('Prisma connect error', err);
  }
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
