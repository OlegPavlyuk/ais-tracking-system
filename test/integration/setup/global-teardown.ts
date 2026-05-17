import { stopIntegrationPostgres } from './testcontainers-postgres';

export default async function globalTeardown(): Promise<void> {
  const postgres = globalThis.__AIS_INTEGRATION_POSTGRES__;
  if (postgres) {
    await stopIntegrationPostgres(postgres);
  }
}
