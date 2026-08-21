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
    // Super Admin: el ÚNICO rol global. Va SIN sucursal (null), ve todas y es el
    // único que puede crear otros Super Admin.
    { nombre: 'Super Admin' },
    // Administrador: gestiona usuarios, pero scopeado a SU sucursal (obligatoria).
    { nombre: 'Administrador' },
    { nombre: 'Supervisor' },
    { nombre: 'Operador' },
    // Gestor: usuario al que se enlazan los vendedores. La sucursal del pedido
    // se deriva vendedor -> gestor -> gestor.sucursalId.
    { nombre: 'Gestor' },
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
  // El usuario semilla `admin` es Super Admin (global, sin sucursal): es quien crea
  // las sucursales y los Administradores de cada una.
  const adminRole = await prisma.rol.findFirst({ where: { nombre: 'Super Admin' } });

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

  // Las sucursales nuevas.
  //
  // Van AQUÍ y no en una migración porque esta aplicación no ejecuta migraciones: su
  // arranque hace `prisma db push`, que sincroniza el esquema y no corre una sola
  // línea del SQL de `prisma/migrations`. Una migración con estos INSERT se quedaría
  // en el repositorio sin ejecutarse nunca, y lo peor es que nadie lo notaría —el
  // despliegue diría "correcto" y las sucursales no estarían.
  //
  // `codigo` es lo que cruza con el Consolidado y con `Branch.externalId` de delivery,
  // así que se elige aquí una vez y no se improvisa después.
  //
  // Con upsert por código: la semilla corre en cada despliegue y esto no duplica nada
  // ni pisa el nombre si alguien lo cambió desde la pantalla.
  const sucursalesNuevas = [
    { nombre: 'Palma Soriano', codigo: 'PLS' },
    { nombre: 'Moa', codigo: 'MOA' },
  ];

  for (const sucursal of sucursalesNuevas) {
    await prisma.sucursal.upsert({
      where: { codigo: sucursal.codigo },
      update: {},
      create: sucursal,
    });
  }

  console.log('Ensured sucursales:', sucursalesNuevas.map((s) => s.codigo).join(', '));
}

main()
  .catch((error) => {
    console.error('Seed error', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
