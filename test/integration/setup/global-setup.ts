import type { IntegrationPostgres } from './testcontainers-postgres';
import { startIntegrationPostgres } from './testcontainers-postgres';

declare global {
  var __AIS_INTEGRATION_POSTGRES__: IntegrationPostgres | undefined;
}

export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.AIS_TESTCONTAINERS_POSTGRES = '1';

  const postgres = await startIntegrationPostgres();
  globalThis.__AIS_INTEGRATION_POSTGRES__ = postgres;
  process.env.DATABASE_URL = postgres.databaseUrl;
}
