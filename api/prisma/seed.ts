import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: dbPath });

const prisma = new PrismaClient({ adapter });

async function main() {
  // Ensure the Roles (model name `Roles`) contains the three default roles.
  const roles = [
    { rol: 'user' },
    { rol: 'admin' },
    { rol: 'supervisor' },
  ];

  await prisma.roles.createMany({ data: roles });

  console.log('Seeded roles:', roles.map(r => r.rol).join(', '));

  // Create default admin user with password '123456' and role 'admin'
  const adminPassword = '123456';
  const hashed = await bcrypt.hash(adminPassword, 10);

  // Find admin role id
  const adminRole = await prisma.roles.findUnique({ where: { rol: 'admin' } });

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      password: hashed,
      roleId: adminRole ? adminRole.id : undefined,
    },
    create: {
      username: 'admin',
      password: hashed,
      roleId: adminRole ? adminRole.id : undefined,
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
