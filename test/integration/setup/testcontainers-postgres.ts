import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

const POSTGIS_IMAGE = 'postgis/postgis:16-3.4';
const POSTGRES_USER = 'ais';
const POSTGRES_PASSWORD = 'ais';
const POSTGRES_DB = 'ais_test';
const POSTGRES_PORT = 5432;

export interface IntegrationPostgres {
  container: StartedTestContainer;
  databaseUrl: string;
}

export function assertIntegrationDatabase(databaseUrl: string): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Integration DB cleanup requires NODE_ENV=test.');
  }
  if (process.env.AIS_TESTCONTAINERS_POSTGRES !== '1') {
    throw new Error('Integration DB cleanup requires the Testcontainers database marker.');
  }

  const parsed = new URL(databaseUrl);
  if (parsed.pathname !== `/${POSTGRES_DB}`) {
    throw new Error(`Integration DB cleanup expected /${POSTGRES_DB}, got "${parsed.pathname}".`);
  }
}

export async function startIntegrationPostgres(): Promise<IntegrationPostgres> {
  const container = await new GenericContainer(POSTGIS_IMAGE)
    .withEnvironment({
      POSTGRES_USER,
      POSTGRES_PASSWORD,
      POSTGRES_DB,
    })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(120_000)
    .start();

  const databaseUrl = [
    'postgres://',
    `${POSTGRES_USER}:${POSTGRES_PASSWORD}`,
    `@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}`,
    `/${POSTGRES_DB}`,
  ].join('');

  try {
    await assertPostgresAvailable(databaseUrl);

    return { container, databaseUrl };
  } catch (err) {
    await container.stop({ remove: true, removeVolumes: true, timeout: 10_000 });
    throw err;
  }
}

export async function stopIntegrationPostgres(instance: IntegrationPostgres): Promise<void> {
  await instance.container.stop({ remove: true, removeVolumes: true, timeout: 10_000 });
}

export async function resetAndMigrateIntegrationDatabase(
  databaseUrl = process.env.DATABASE_URL,
): Promise<void> {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL was not provided by Jest integration global setup.');
  }
  assertIntegrationDatabase(databaseUrl);

  await resetDatabaseSchemas(databaseUrl);
  await runMigrations(databaseUrl);
  await assertPostgisAvailable(databaseUrl);
}

async function resetDatabaseSchemas(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await client`DROP SCHEMA IF EXISTS public CASCADE`;
    await client`CREATE SCHEMA public`;
    await client.unsafe(`GRANT ALL ON SCHEMA public TO ${POSTGRES_USER}`);
    await client`GRANT ALL ON SCHEMA public TO public`;
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function assertPostgresAvailable(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const rows = await client<{ ok: number }[]>`
      SELECT 1 AS ok
    `;
    if (rows[0]?.ok !== 1) {
      throw new Error('Postgres readiness query returned an unexpected result');
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function assertPostgisAvailable(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const rows = await client<{ version: string }[]>`
      SELECT PostGIS_Version() AS version
    `;
    if (!rows[0]?.version) {
      throw new Error('PostGIS_Version() returned no version');
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}
