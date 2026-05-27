import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import path from 'path';

const rawProvider = (process.env.DATABASE_PROVIDER ?? '').toLowerCase();
const databaseUrl = process.env.DATABASE_URL ?? '';

function getSqlitePathFromUrl(url: string) {
  if (!url.startsWith('file:')) {
    return path.join(process.cwd(), 'prisma', 'dev.db');
  }

  const filePath = url.replace(/^file:/, '');
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function shouldUseSqliteAdapter() {
  if (rawProvider === 'postgres' || rawProvider === 'postgresql') {
    return false;
  }

  if (rawProvider === 'sqlite') {
    return true;
  }

  return databaseUrl === '' || databaseUrl.startsWith('file:');
}

const prismaClientSingleton = () => {
  if (shouldUseSqliteAdapter()) {
    const dbPath = getSqlitePathFromUrl(databaseUrl);
    const adapter = new PrismaBetterSqlite3({ url: dbPath });
    return new PrismaClient({ adapter });
  }

  return new PrismaClient({
    adapter: new PrismaPg(databaseUrl || process.env.DATABASE_URL || ''),
  });
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
