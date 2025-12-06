import { defineConfig } from '@prisma/config';

export default defineConfig({
  datasource: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./prisma/dev.db'
  },
  generators: {
    client: {
      provider: 'prisma-client-js',
    }
  },
  migrations: {
    seed: 'npx ts-node prisma/seed.ts'
  }
});
