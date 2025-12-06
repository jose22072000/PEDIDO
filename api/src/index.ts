import express from 'express';
import multer from 'multer';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import ordersRouter from './routes/orders';
import authRouter from './routes/auth';
import prisma from './prismaClient';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors({
  origin: true, // Allow all origins in development, specify domain in production
  credentials: true, // Allow cookies to be sent
}));
app.use(cookieParser());
app.use(express.json());
// Use urlencoded parser for simple form submissions. We avoid a global JSON
// body-parser to keep compatibility with multipart/form-data uploads handled
// via multer on specific routes.
app.use(express.urlencoded({ extended: true }));

// Multer setup for file uploads. Use per-route middleware like
// `upload.single('file')` or `upload.array('files')` in route handlers.
const upload = multer({ dest: 'uploads/' });
app.locals.upload = upload;

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/orders', ordersRouter);

app.listen(port, async () => {
  console.log(`API listening on http://localhost:${port}`);
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
