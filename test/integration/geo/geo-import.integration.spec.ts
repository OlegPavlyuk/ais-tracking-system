import postgres, { Sql } from 'postgres';
import { runGeoImport } from '../../../scripts/geo/import-geo-datasets';
import { assertIntegrationDatabase } from '../setup/testcontainers-postgres';

const FIXTURE_DATASETS_PATH = 'scripts/geo/datasets.fixture.json';

interface ActiveVersionRow {
  id: string;
  version: string;
}

interface CountRow {
  count: number;
}

interface GeoValidationResult {
  verdict: 'allow' | 'reject' | 'uncertain';
  reason:
    | 'manual_allow'
    | 'navigable_water'
    | 'coastal_tolerance'
    | 'deep_land'
    | 'not_land'
    | 'dataset_unavailable'
    | 'invalid_coordinates';
  datasetVersion: string | null;
}

async function resetGeoData(client: Sql): Promise<void> {
  await client`
    TRUNCATE TABLE
      geo_manual_overrides,
      geo_navigable_water_polygons,
      geo_land_polygons,
      geo_dataset_versions
    RESTART IDENTITY CASCADE
  `;
}

async function activeVersion(client: Sql): Promise<ActiveVersionRow | undefined> {
  const rows = await client<ActiveVersionRow[]>`
    SELECT id, version
    FROM geo_dataset_versions
    WHERE is_active
  `;
  return rows[0];
}

async function countRows(
  client: Sql,
  tableName: string,
  datasetVersionId: string,
): Promise<number> {
  const rows = await client<CountRow[]>`
    SELECT count(*)::int AS count
    FROM ${client(tableName)}
    WHERE dataset_version_id = ${datasetVersionId}
  `;
  return rows[0]?.count ?? 0;
}

async function countRowsBySource(
  client: Sql,
  tableName: string,
  datasetVersionId: string,
  source: string,
): Promise<number> {
  const rows = await client<CountRow[]>`
    SELECT count(*)::int AS count
    FROM ${client(tableName)}
    WHERE dataset_version_id = ${datasetVersionId}
      AND source = ${source}
  `;
  return rows[0]?.count ?? 0;
}

async function validate(client: Sql, lon: number, lat: number): Promise<GeoValidationResult> {
  const rows = await client<{ result: GeoValidationResult }[]>`
    SELECT geo_validate_position(${lon}, ${lat}) AS result
  `;
  const result = rows[0]?.result;
  if (!result) {
    throw new Error('geo_validate_position returned no result');
  }
  return result;
}

describe('geo dataset import tooling', () => {
  let client: Sql;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL was not provided by Jest integration global setup.');
    }
    assertIntegrationDatabase(process.env.DATABASE_URL);
    client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => undefined });
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetGeoData(client);
  });

  it('bootstraps a fresh database and imports clipped dataset rows', async () => {
    await runGeoImport({
      databaseUrl: process.env.DATABASE_URL,
      datasetsPath: FIXTURE_DATASETS_PATH,
      useOgr2ogr: false,
      workDir: '.geo-import-test',
    });

    const active = await activeVersion(client);
    expect(active).toBeDefined();
    expect(await countRows(client, 'geo_land_polygons', active!.id)).toBeGreaterThan(0);
    expect(await countRows(client, 'geo_navigable_water_polygons', active!.id)).toBeGreaterThan(0);
    expect(await countRows(client, 'geo_manual_overrides', active!.id)).toBeGreaterThan(0);
    expect(
      await countRowsBySource(
        client,
        'geo_navigable_water_polygons',
        active!.id,
        'phase8-geofabrik-waterways-fixture',
      ),
    ).toBeGreaterThan(0);

    await expect(validate(client, 30.07, 45.07)).resolves.toMatchObject({
      verdict: 'allow',
      reason: 'manual_allow',
      datasetVersion: active!.version,
    });
    await expect(validate(client, 7.58678, 47.56220333333333)).resolves.toMatchObject({
      verdict: 'allow',
      reason: 'navigable_water',
      datasetVersion: active!.version,
    });
    await expect(validate(client, 7.61, 47.56)).resolves.toMatchObject({
      verdict: 'reject',
      reason: 'deep_land',
      datasetVersion: active!.version,
    });
  });

  it('can be safely rerun and activates only the latest successful version', async () => {
    const firstVersion = await runGeoImport({
      databaseUrl: process.env.DATABASE_URL,
      datasetsPath: FIXTURE_DATASETS_PATH,
      useOgr2ogr: false,
      workDir: '.geo-import-test',
    });
    const firstActive = await activeVersion(client);

    const secondVersion = await runGeoImport({
      databaseUrl: process.env.DATABASE_URL,
      datasetsPath: FIXTURE_DATASETS_PATH,
      useOgr2ogr: false,
      workDir: '.geo-import-test',
    });
    const secondActive = await activeVersion(client);

    expect(secondVersion).not.toEqual(firstVersion);
    expect(firstActive?.version).toEqual(firstVersion);
    expect(secondActive?.version).toEqual(secondVersion);

    const activeCount = await client<CountRow[]>`
      SELECT count(*)::int AS count
      FROM geo_dataset_versions
      WHERE is_active
    `;
    expect(activeCount[0]?.count).toBe(1);
  });

  it('leaves the previous active version untouched when an import fails', async () => {
    const firstVersion = await runGeoImport({
      databaseUrl: process.env.DATABASE_URL,
      datasetsPath: FIXTURE_DATASETS_PATH,
      useOgr2ogr: false,
      workDir: '.geo-import-test',
    });
    const firstActive = await activeVersion(client);

    await expect(
      runGeoImport({
        databaseUrl: process.env.DATABASE_URL,
        datasetsPath: FIXTURE_DATASETS_PATH,
        useOgr2ogr: false,
        workDir: '.geo-import-test',
        failAfterLoad: true,
      }),
    ).rejects.toThrow('Intentional geo import failure');

    const activeAfterFailure = await activeVersion(client);
    expect(firstActive?.version).toEqual(firstVersion);
    expect(activeAfterFailure?.id).toEqual(firstActive?.id);
    expect(activeAfterFailure?.version).toEqual(firstVersion);
  });
});
