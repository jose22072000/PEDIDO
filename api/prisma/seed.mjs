import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import path from 'path';

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
  if (rawProvider === 'postgres' || rawProvider === 'postgresql') {
    return false;
  }

  if (rawProvider === 'sqlite') {
    return true;
  }

  return databaseUrl === '' || databaseUrl.startsWith('file:');
}

function createPrismaClient() {
  if (shouldUseSqliteAdapter()) {
    return new PrismaClient({
      adapter: new PrismaBetterSqlite3({
        url: getSqlitePathFromUrl(databaseUrl),
      }),
    });
  }

  return new PrismaClient({
    adapter: new PrismaPg(databaseUrl),
  });
}

const prisma = createPrismaClient();

async function main() {
  const roles = [
    { nombre: 'Administrador' },
    { nombre: 'Supervisor' },
    { nombre: 'Operador' },
  ];

  for (const role of roles) {
    await prisma.rol.upsert({
      where: { nombre: role.nombre },
      update: {},
      create: role,
    });
  }

  console.log('Seeded roles:', roles.map((r) => r.nombre).join(', '));

  const adminPassword = 'Master.123';
  const hashed = await bcrypt.hash(adminPassword, 10);
  const adminRole = await prisma.rol.findFirst({ where: { nombre: 'Administrador' } });

  await prisma.usuario.upsert({
    where: { username: 'admin' },
    update: {
      password: hashed,
      rolId: adminRole ? adminRole.id : undefined,
    },
    create: {
      username: 'admin',
      password: hashed,
      rolId: adminRole ? adminRole.id : undefined,
    },
  });

  console.log('Ensured admin user seeded (username: admin)');
}

main()
  .catch((error) => {
    console.error('Seed error', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
