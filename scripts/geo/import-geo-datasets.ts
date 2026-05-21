import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres, { Sql } from 'postgres';
import { AIS_COVERAGE_ZONES, Bbox } from '../../src/shared/config/constants';

const execFileAsync = promisify(execFile);

const DEFAULT_DATASETS_PATH = 'scripts/geo/datasets.json';
const DEFAULT_MANUAL_OVERRIDES_DIR = 'data/geo/manual-overrides';
const DEFAULT_WORK_DIR = '.geo-import';
const ALLOWED_TARGET_TABLES = new Set([
  'geo_land_polygons',
  'geo_navigable_water_polygons',
  'geo_manual_overrides',
]);

type TargetTable = 'geo_land_polygons' | 'geo_navigable_water_polygons' | 'geo_manual_overrides';
type TransactionSql = postgres.TransactionSql;

interface DatasetSource {
  name: string;
  type: string;
  region: string;
  sourceLayer?: string;
  targetTable: TargetTable;
  path?: string;
  url?: string;
  license: string;
  attribution: string;
  pinnedVersion?: string;
  checksumSha256?: string;
}

interface DatasetManifest {
  metadataVersion: string;
  description?: string;
  sources: DatasetSource[];
}

interface ImportOptions {
  databaseUrl: string;
  datasetsPath: string;
  manualOverridesDir: string;
  workDir: string;
  useOgr2ogr: boolean;
  coverageMarginKm: number;
  coastalToleranceMeters: number;
  failAfterLoad: boolean;
}

interface PreparedSource extends DatasetSource {
  absolutePath: string;
  stagingTable: string;
}

export async function runGeoImport(overrides: Partial<ImportOptions> = {}): Promise<string> {
  const options = readOptions(overrides);
  const manifest = await readManifest(options.datasetsPath);
  validateManifest(manifest);

  const importId = randomUUID();
  const startedAt = new Date().toISOString();
  const version = buildDatasetVersion(manifest, startedAt, importId);
  const importWorkDir = path.resolve(options.workDir, importId);
  const client = postgres(options.databaseUrl, { max: 1, onnotice: () => undefined });

  await mkdir(importWorkDir, { recursive: true });

  try {
    const datasetSources = await prepareSources(manifest.sources, importWorkDir);
    const manualSources = await prepareManualOverrideSources(
      options.manualOverridesDir,
      importWorkDir,
    );
    const sources = [...datasetSources, ...manualSources].map((source, index) => ({
      ...source,
      stagingTable: `geo_import_staging_${importId.replaceAll('-', '_')}_${index}`,
    }));

    for (const source of sources) {
      await loadSourceToStaging(client, source, options);
    }

    if (options.failAfterLoad) {
      throw new Error('Intentional geo import failure after staging load.');
    }

    await activateImportedVersion(client, {
      version,
      manifest,
      sources,
      options,
      startedAt,
    });

    console.log(`Geo dataset import activated version ${version}`);
    return version;
  } finally {
    await dropStagingTables(client, importId);
    await client.end({ timeout: 5 });
    await rm(importWorkDir, { recursive: true, force: true });
  }
}

function readOptions(overrides: Partial<ImportOptions>): ImportOptions {
  const databaseUrl = overrides.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for geo import.');
  }

  return {
    databaseUrl,
    datasetsPath: overrides.datasetsPath ?? process.env.GEO_DATASETS_PATH ?? DEFAULT_DATASETS_PATH,
    manualOverridesDir:
      overrides.manualOverridesDir ??
      process.env.GEO_MANUAL_OVERRIDES_DIR ??
      DEFAULT_MANUAL_OVERRIDES_DIR,
    workDir: overrides.workDir ?? process.env.GEO_IMPORT_WORK_DIR ?? DEFAULT_WORK_DIR,
    useOgr2ogr:
      overrides.useOgr2ogr ?? process.env.GEO_IMPORT_USE_OGR2OGR?.toLowerCase() !== 'false',
    coverageMarginKm: readPositiveNumber(
      overrides.coverageMarginKm,
      process.env.GEO_COVERAGE_MARGIN_KM,
      50,
      'GEO_COVERAGE_MARGIN_KM',
    ),
    coastalToleranceMeters: readPositiveNumber(
      overrides.coastalToleranceMeters,
      process.env.GEO_COASTAL_TOLERANCE_METERS,
      500,
      'GEO_COASTAL_TOLERANCE_METERS',
    ),
    failAfterLoad: overrides.failAfterLoad ?? process.env.GEO_IMPORT_FAIL_AFTER_LOAD === 'true',
  };
}

function readPositiveNumber(
  override: number | undefined,
  envValue: string | undefined,
  defaultValue: number,
  name: string,
): number {
  const value = override ?? (envValue ? Number(envValue) : defaultValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

async function readManifest(datasetsPath: string): Promise<DatasetManifest> {
  const raw = await readFile(path.resolve(datasetsPath), 'utf8');
  return JSON.parse(raw) as DatasetManifest;
}

function validateManifest(manifest: DatasetManifest): void {
  if (!manifest.metadataVersion) {
    throw new Error('Geo dataset manifest requires metadataVersion.');
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('Geo dataset manifest requires at least one source.');
  }
  for (const source of manifest.sources) {
    if (!source.name || !source.type || !source.region || !source.targetTable) {
      throw new Error(`Geo dataset source is missing required metadata: ${JSON.stringify(source)}`);
    }
    if (!ALLOWED_TARGET_TABLES.has(source.targetTable)) {
      throw new Error(`Unsupported geo target table "${source.targetTable}".`);
    }
    if (!source.path && !source.url) {
      throw new Error(`Geo dataset source "${source.name}" requires path or url.`);
    }
  }
}

function buildDatasetVersion(
  manifest: DatasetManifest,
  startedAt: string,
  importId: string,
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(manifest))
    .update(startedAt)
    .update(importId)
    .digest('hex')
    .slice(0, 12);
  return `${manifest.metadataVersion}-${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${hash}`;
}

async function prepareSources(
  sources: DatasetSource[],
  importWorkDir: string,
): Promise<Omit<PreparedSource, 'stagingTable'>[]> {
  return Promise.all(
    sources.map(async (source) => ({
      ...source,
      absolutePath: await materializeSource(source, importWorkDir),
    })),
  );
}

async function prepareManualOverrideSources(
  manualOverridesDir: string,
  importWorkDir: string,
): Promise<Omit<PreparedSource, 'stagingTable'>[]> {
  const absoluteDir = path.resolve(manualOverridesDir);
  try {
    const dirStat = await stat(absoluteDir);
    if (!dirStat.isDirectory()) {
      throw new Error(`${absoluteDir} is not a directory.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const entries = await readdir(absoluteDir);
  const geojsonFiles = entries
    .filter((entry) => entry.endsWith('.geojson') || entry.endsWith('.json'))
    .sort();

  return Promise.all(
    geojsonFiles.map(async (entry) => {
      const filePath = path.join(absoluteDir, entry);
      const source: DatasetSource = {
        name: `manual-override:${entry}`,
        type: 'manual_allow',
        region: 'manual',
        sourceLayer: 'manual_allow',
        targetTable: 'geo_manual_overrides',
        path: filePath,
        license: 'Repository-owned manual override',
        attribution: 'AIS Tracking System manual override',
        pinnedVersion: entry,
      };
      return {
        ...source,
        absolutePath: await materializeSource(source, importWorkDir),
      };
    }),
  );
}

async function materializeSource(source: DatasetSource, importWorkDir: string): Promise<string> {
  const targetPath = path.join(importWorkDir, `${sanitizeName(source.name)}.geojson`);
  if (source.path) {
    const absolutePath = path.resolve(source.path);
    const content = await readFile(absolutePath);
    await verifyChecksum(source, content);
    await writeFile(targetPath, content);
    return targetPath;
  }

  if (!source.url) {
    throw new Error(`Geo dataset source "${source.name}" has no path or url.`);
  }

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${source.name} from ${source.url}: ${response.status}`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  await verifyChecksum(source, content);
  await writeFile(targetPath, content);
  return targetPath;
}

async function verifyChecksum(source: DatasetSource, content: Buffer): Promise<void> {
  if (!source.checksumSha256) {
    return;
  }
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== source.checksumSha256) {
    throw new Error(`Checksum mismatch for geo dataset source "${source.name}".`);
  }
}

async function loadSourceToStaging(
  client: Sql,
  source: PreparedSource,
  options: ImportOptions,
): Promise<void> {
  await dropTable(client, source.stagingTable);

  if (options.useOgr2ogr) {
    await loadWithOgr2ogr(source, options.databaseUrl);
    await ensureStagingGeometryColumn(client, source.stagingTable);
    return;
  }

  await loadGeoJsonWithPostgis(client, source);
}

async function loadWithOgr2ogr(source: PreparedSource, databaseUrl: string): Promise<void> {
  const args = [
    '-f',
    'PostgreSQL',
    toOgrPostgresConnection(databaseUrl),
    source.absolutePath,
    '-nln',
    source.stagingTable,
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-lco',
    'GEOMETRY_NAME=geom',
    '-overwrite',
    '-t_srs',
    'EPSG:4326',
    '-skipfailures',
  ];
  try {
    await execFileAsync('ogr2ogr', args, { maxBuffer: 1024 * 1024 * 8 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ogr2ogr failed while loading "${source.name}": ${message}`);
  }
}

function toOgrPostgresConnection(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const parts = [
    `host=${parsed.hostname}`,
    `port=${parsed.port || '5432'}`,
    `dbname=${parsed.pathname.slice(1)}`,
  ];
  if (parsed.username) {
    parts.push(`user=${decodeURIComponent(parsed.username)}`);
  }
  if (parsed.password) {
    parts.push(`password=${decodeURIComponent(parsed.password)}`);
  }
  return `PG:${parts.join(' ')}`;
}

async function loadGeoJsonWithPostgis(client: Sql, source: PreparedSource): Promise<void> {
  const raw = await readFile(source.absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as { features?: Array<{ geometry?: unknown }> };
  const features = parsed.features ?? [];

  await client.unsafe(
    `CREATE TABLE "${source.stagingTable}" (
      id bigserial PRIMARY KEY,
      geom geometry(Geometry, 4326) NOT NULL
    )`,
  );

  for (const feature of features) {
    if (!feature.geometry) {
      continue;
    }
    await client`
      INSERT INTO ${client(source.stagingTable)} (geom)
      VALUES (ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326))
    `;
  }
}

async function ensureStagingGeometryColumn(client: Sql, stagingTable: string): Promise<void> {
  const rows = await client<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${stagingTable}
        AND column_name = 'geom'
    ) AS exists
  `;
  if (!rows[0]?.exists) {
    throw new Error(`Staging table "${stagingTable}" does not contain geom column.`);
  }
}

async function activateImportedVersion(
  client: Sql,
  params: {
    version: string;
    manifest: DatasetManifest;
    sources: PreparedSource[];
    options: ImportOptions;
    startedAt: string;
  },
): Promise<void> {
  const { version, manifest, sources, options, startedAt } = params;

  await client.begin(async (tx) => {
    await createCoverageTable(tx, options.coverageMarginKm);

    const versionRows = await tx<{ id: string }[]>`
      INSERT INTO geo_dataset_versions (
        version,
        source_metadata,
        coverage_margin_km,
        coastal_tolerance_meters,
        is_active
      )
      VALUES (
        ${version},
        ${JSON.stringify({
          manifest,
          coverageZones: AIS_COVERAGE_ZONES,
          importStartedAt: startedAt,
          loader: options.useOgr2ogr ? 'ogr2ogr' : 'postgis_geojson_fallback',
        })}::jsonb,
        ${options.coverageMarginKm},
        ${options.coastalToleranceMeters},
        false
      )
      RETURNING id
    `;
    const datasetVersionId = versionRows[0]?.id;
    if (!datasetVersionId) {
      throw new Error('Failed to create geo dataset version.');
    }

    for (const source of sources) {
      await insertProcessedGeometries(tx, source, datasetVersionId);
    }

    await ensureImportHasData(tx, datasetVersionId);
    await refreshIndexesAndStatistics(tx);
    await tx`UPDATE geo_dataset_versions SET is_active = false WHERE is_active`;
    await tx`
      UPDATE geo_dataset_versions
      SET is_active = true, activated_at = now()
      WHERE id = ${datasetVersionId}
    `;
  });
}

async function createCoverageTable(tx: TransactionSql, coverageMarginKm: number): Promise<void> {
  await tx`CREATE TEMP TABLE geo_import_coverage (geom geometry(MultiPolygon, 4326)) ON COMMIT DROP`;
  for (const zone of AIS_COVERAGE_ZONES) {
    await tx`
      INSERT INTO geo_import_coverage (geom)
      VALUES (ST_Multi(ST_MakeEnvelope(
        ${zone.bbox.minLon},
        ${zone.bbox.minLat},
        ${zone.bbox.maxLon},
        ${zone.bbox.maxLat},
        4326
      )))
    `;
  }
  await tx`
    UPDATE geo_import_coverage
    SET geom = ST_Multi(ST_Buffer(geom::geography, ${coverageMarginKm * 1000})::geometry)
  `;
  await tx`
    CREATE TEMP TABLE geo_import_coverage_union ON COMMIT DROP AS
    SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom
    FROM geo_import_coverage
  `;
}

async function insertProcessedGeometries(
  tx: TransactionSql,
  source: PreparedSource,
  datasetVersionId: string,
): Promise<void> {
  await tx`
    INSERT INTO ${tx(source.targetTable)} (
      dataset_version_id,
      source,
      source_layer,
      region,
      geom
    )
    SELECT
      ${datasetVersionId},
      ${source.name},
      ${source.sourceLayer ?? source.type},
      ${source.region},
      processed.geom
    FROM ${tx(source.stagingTable)} staging
    CROSS JOIN geo_import_coverage_union coverage
    CROSS JOIN LATERAL ST_Dump(
      ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(staging.geom, coverage.geom)),
        3
      )
    ) dumped
    CROSS JOIN LATERAL ST_Subdivide(dumped.geom, 256) AS processed(geom)
    WHERE ST_Intersects(staging.geom, coverage.geom)
      AND NOT ST_IsEmpty(processed.geom)
  `;
}

async function ensureImportHasData(tx: TransactionSql, datasetVersionId: string): Promise<void> {
  const rows = await tx<{ table_name: TargetTable; count: number }[]>`
    SELECT 'geo_land_polygons'::text AS table_name, count(*)::int AS count
    FROM geo_land_polygons
    WHERE dataset_version_id = ${datasetVersionId}
    UNION ALL
    SELECT 'geo_navigable_water_polygons'::text AS table_name, count(*)::int AS count
    FROM geo_navigable_water_polygons
    WHERE dataset_version_id = ${datasetVersionId}
    UNION ALL
    SELECT 'geo_manual_overrides'::text AS table_name, count(*)::int AS count
    FROM geo_manual_overrides
    WHERE dataset_version_id = ${datasetVersionId}
  `;
  const landCount = rows.find((row) => row.table_name === 'geo_land_polygons')?.count ?? 0;
  const waterCount =
    rows.find((row) => row.table_name === 'geo_navigable_water_polygons')?.count ?? 0;
  if (landCount <= 0 || waterCount <= 0) {
    throw new Error(
      `Geo import produced insufficient data: land=${landCount}, navigable_water=${waterCount}.`,
    );
  }
}

async function refreshIndexesAndStatistics(tx: TransactionSql): Promise<void> {
  await tx`CREATE INDEX IF NOT EXISTS geo_land_polygons_dataset_version_idx ON geo_land_polygons USING btree (dataset_version_id)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_land_polygons_source_idx ON geo_land_polygons USING btree (source)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_land_polygons_geom_gist ON geo_land_polygons USING gist (geom)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_navigable_water_polygons_dataset_version_idx ON geo_navigable_water_polygons USING btree (dataset_version_id)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_navigable_water_polygons_source_idx ON geo_navigable_water_polygons USING btree (source)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_navigable_water_polygons_geom_gist ON geo_navigable_water_polygons USING gist (geom)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_manual_overrides_dataset_version_idx ON geo_manual_overrides USING btree (dataset_version_id)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_manual_overrides_source_idx ON geo_manual_overrides USING btree (source)`;
  await tx`CREATE INDEX IF NOT EXISTS geo_manual_overrides_geom_gist ON geo_manual_overrides USING gist (geom)`;
  await tx`ANALYZE geo_dataset_versions`;
  await tx`ANALYZE geo_land_polygons`;
  await tx`ANALYZE geo_navigable_water_polygons`;
  await tx`ANALYZE geo_manual_overrides`;
}

async function dropStagingTables(client: Sql, importId: string): Promise<void> {
  const prefix = `geo_import_staging_${importId.replaceAll('-', '_')}_`;
  const rows = await client<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE ${`${prefix}%`}
  `;
  for (const row of rows) {
    await dropTable(client, row.table_name);
  }
}

async function dropTable(client: Sql, tableName: string): Promise<void> {
  await client.unsafe(`DROP TABLE IF EXISTS "${tableName}"`);
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');
}

export function coverageZonesForImport(): readonly { name: string; bbox: Bbox }[] {
  return AIS_COVERAGE_ZONES;
}

if (require.main === module) {
  runGeoImport().catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  });
}
