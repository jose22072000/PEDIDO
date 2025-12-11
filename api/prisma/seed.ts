import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: dbPath });

const prisma = new PrismaClient({ adapter });

async function main() {
  // Ensure the Roles contains the default roles.
  const roles = [
    { nombre: 'Administrador' },
    { nombre: 'Vendedor' },
    { nombre: 'Usuario' },
  ];

  for (const role of roles) {
    await prisma.rol.upsert({
      where: { nombre: role.nombre },
      update: {},
      create: role,
    });
  }

  console.log('Seeded roles:', roles.map(r => r.nombre).join(', '));

  // Create default admin user with password '123456' and role 'Administrador'
  const adminPassword = '123456';
  const hashed = await bcrypt.hash(adminPassword, 10);

  // Find Administrador role id
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
  .catch((e) => {
    console.error('Seed error', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
