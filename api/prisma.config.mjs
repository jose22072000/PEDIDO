import { defineConfig } from '@prisma/config';

const providerFromEnv = (process.env.DATABASE_PROVIDER ?? '').toLowerCase();
const datasourceProvider =
  providerFromEnv === 'postgres'
    ? 'postgresql'
    : providerFromEnv || (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite');

const datasourceUrl =
  datasourceProvider === 'sqlite'
    ? process.env.DATABASE_URL || 'file:./prisma/dev.db'
    : process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/procovar_pedidos?schema=public';

export default defineConfig({
  datasource: {
    provider: datasourceProvider,
    url: datasourceUrl,
  },
  generators: {
    client: {
      provider: 'prisma-client-js',
    }
  },
  migrations: {
    seed: 'node prisma/seed.mjs'
  }
});
