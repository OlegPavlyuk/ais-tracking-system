import { resetAndMigrateIntegrationDatabase } from './testcontainers-postgres';

beforeAll(async () => {
  await resetAndMigrateIntegrationDatabase();
});
