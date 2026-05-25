import postgres, { Sql } from 'postgres';
import { assertIntegrationDatabase } from '../setup/testcontainers-postgres';

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

async function seedFixtureDataset(client: Sql): Promise<string> {
  const versionRows = await client<{ id: string }[]>`
    INSERT INTO geo_dataset_versions (
      version,
      source_metadata,
      coverage_margin_km,
      coastal_tolerance_meters,
      is_active,
      activated_at
    )
    VALUES (
      'fixture-v1',
      '{"fixture": true}'::jsonb,
      50,
      500,
      true,
      now()
    )
    RETURNING id
  `;
  const datasetVersionId = versionRows[0]?.id;
  if (!datasetVersionId) {
    throw new Error('failed to create fixture geo dataset version');
  }

  await client`
    INSERT INTO geo_land_polygons (dataset_version_id, source, source_layer, region, geom)
    VALUES (
      ${datasetVersionId},
      'fixture',
      'land',
      'test',
      ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326)
    )
  `;

  await client`
    INSERT INTO geo_navigable_water_polygons (
      dataset_version_id,
      source,
      source_layer,
      region,
      geom
    )
    VALUES (
      ${datasetVersionId},
      'fixture',
      'navigable_water',
      'test',
      ST_GeomFromText('POLYGON((0.40 0.40, 0.60 0.40, 0.60 0.60, 0.40 0.60, 0.40 0.40))', 4326)
    )
  `;

  await client`
    INSERT INTO geo_manual_overrides (dataset_version_id, source, source_layer, region, geom)
    VALUES (
      ${datasetVersionId},
      'fixture',
      'manual_allow',
      'test',
      ST_GeomFromText('POLYGON((0.45 0.45, 0.55 0.45, 0.55 0.55, 0.45 0.55, 0.45 0.45))', 4326)
    )
  `;

  return datasetVersionId;
}

describe('geo_validate_position integration', () => {
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

  it('returns dataset_unavailable when no active dataset exists', async () => {
    await expect(validate(client, 0.5, 0.5)).resolves.toEqual({
      verdict: 'allow',
      reason: 'dataset_unavailable',
      datasetVersion: null,
    });
  });

  it('rejects invalid coordinates before spatial validation', async () => {
    await seedFixtureDataset(client);

    await expect(validate(client, 181, 0)).resolves.toEqual({
      verdict: 'reject',
      reason: 'invalid_coordinates',
      datasetVersion: null,
    });
    await expect(validate(client, 0, -91)).resolves.toEqual({
      verdict: 'reject',
      reason: 'invalid_coordinates',
      datasetVersion: null,
    });
  });

  it('applies verdict evaluation order with fixture geometries', async () => {
    await seedFixtureDataset(client);

    await expect(validate(client, 0.5, 0.5)).resolves.toMatchObject({
      verdict: 'allow',
      reason: 'manual_allow',
      datasetVersion: 'fixture-v1',
    });
    await expect(validate(client, 0.42, 0.42)).resolves.toMatchObject({
      verdict: 'allow',
      reason: 'navigable_water',
      datasetVersion: 'fixture-v1',
    });
    await expect(validate(client, 0.998, 0.5)).resolves.toMatchObject({
      verdict: 'uncertain',
      reason: 'coastal_tolerance',
      datasetVersion: 'fixture-v1',
    });
    await expect(validate(client, 0.75, 0.75)).resolves.toMatchObject({
      verdict: 'reject',
      reason: 'deep_land',
      datasetVersion: 'fixture-v1',
    });
    await expect(validate(client, 2, 2)).resolves.toMatchObject({
      verdict: 'allow',
      reason: 'not_land',
      datasetVersion: 'fixture-v1',
    });
  });

  it('uses only the active dataset version', async () => {
    await seedFixtureDataset(client);

    const nextRows = await client<{ id: string }[]>`
      INSERT INTO geo_dataset_versions (
        version,
        source_metadata,
        coverage_margin_km,
        coastal_tolerance_meters,
        is_active,
        activated_at
      )
      VALUES ('fixture-v2', '{"fixture": true}'::jsonb, 50, 500, false, now())
      RETURNING id
    `;
    const inactiveDatasetVersionId = nextRows[0]?.id;
    if (!inactiveDatasetVersionId) {
      throw new Error('failed to create inactive fixture geo dataset version');
    }
    await client`
      INSERT INTO geo_land_polygons (dataset_version_id, source, source_layer, region, geom)
      VALUES (
        ${inactiveDatasetVersionId},
        'fixture',
        'land',
        'test',
        ST_GeomFromText('POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))', 4326)
      )
    `;

    await expect(validate(client, 2.5, 2.5)).resolves.toMatchObject({
      verdict: 'allow',
      reason: 'not_land',
      datasetVersion: 'fixture-v1',
    });
  });
});
