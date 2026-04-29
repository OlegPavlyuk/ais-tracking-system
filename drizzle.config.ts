import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/storage/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ais:ais@localhost:5432/ais',
  },
  strict: true,
  verbose: true,
});
