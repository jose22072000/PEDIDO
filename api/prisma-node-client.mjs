// Cliente Prisma para scripts .mjs (Node) bajo Prisma 7.
// Prisma 7 ya no acepta `new PrismaClient()` sin opciones: hay que pasarle un
// driver adapter. Este helper elige el adapter según DATABASE_PROVIDER / DATABASE_URL,
// igual que src/prismaClient.ts y prisma/seed.mjs, para no repetir la lógica.
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import path from 'node:path';

const rawProvider = (process.env.DATABASE_PROVIDER ?? '').toLowerCase();
const databaseUrl = process.env.DATABASE_URL ?? '';

function getSqlitePathFromUrl(url) {
  if (!url.startsWith('file:')) {
    return path.join(process.cwd(), 'prisma', 'dev.db');
  }
  const filePath = url.replace(/^file:/, '');
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function shouldUseSqliteAdapter() {
  if (rawProvider === 'postgres' || rawProvider === 'postgresql') return false;
  if (rawProvider === 'sqlite') return true;
  return databaseUrl === '' || databaseUrl.startsWith('file:');
}

export function createPrismaClient() {
  if (shouldUseSqliteAdapter()) {
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: getSqlitePathFromUrl(databaseUrl) }) });
  }
  return new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
}
