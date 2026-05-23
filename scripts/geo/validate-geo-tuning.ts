import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { loadEnvFileForLocalDevelopment } from '../../src/shared/config/load-env';

type GeoValidationVerdict = 'allow' | 'reject' | 'uncertain';
type GeoValidationReason =
  | 'manual_allow'
  | 'navigable_water'
  | 'coastal_tolerance'
  | 'deep_land'
  | 'not_land'
  | 'dataset_unavailable'
  | 'invalid_coordinates'
  | 'geo_validation_error'
  | 'disabled';

interface TuningProbe {
  name: string;
  lon: number;
  lat: number;
  expectedVerdict: GeoValidationVerdict;
  expectedReason: GeoValidationReason;
}

interface TuningProbeManifest {
  metadataVersion: string;
  probes: TuningProbe[];
}

interface GeoValidationResult {
  verdict: GeoValidationVerdict;
  reason: GeoValidationReason;
  datasetVersion: string | null;
}

const DEFAULT_PROBES_PATH = 'scripts/geo/tuning-probes.json';

async function main(): Promise<void> {
  loadEnvFileForLocalDevelopment();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for geo tuning validation.');
  }

  const probesPath = process.env.GEO_TUNING_PROBES_PATH ?? DEFAULT_PROBES_PATH;
  const manifest = await readProbeManifest(probesPath);
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

  try {
    const rows = await client<{ version: string }[]>`
      SELECT version
      FROM geo_dataset_versions
      WHERE is_active
      ORDER BY activated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `;
    const activeVersion = rows[0]?.version;
    if (!activeVersion) {
      throw new Error('No active geo dataset version is available for tuning validation.');
    }

    const failures: string[] = [];
    for (const probe of manifest.probes) {
      const result = await validateProbe(client, probe);
      const passed =
        result.verdict === probe.expectedVerdict && result.reason === probe.expectedReason;
      const prefix = passed ? 'PASS' : 'FAIL';
      console.log(
        `${prefix} ${probe.name}: ${result.verdict}/${result.reason} dataset=${result.datasetVersion}`,
      );

      if (!passed) {
        failures.push(
          `${probe.name} expected ${probe.expectedVerdict}/${probe.expectedReason}, got ${result.verdict}/${result.reason}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`Geo tuning validation failed:\n${failures.join('\n')}`);
    }

    console.log(
      `Geo tuning validation passed ${manifest.probes.length} probes against ${activeVersion}`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function readProbeManifest(probesPath: string): Promise<TuningProbeManifest> {
  const raw = await readFile(path.resolve(probesPath), 'utf8');
  const manifest = JSON.parse(raw) as TuningProbeManifest;

  if (!manifest.metadataVersion) {
    throw new Error('Geo tuning probe manifest requires metadataVersion.');
  }
  if (!Array.isArray(manifest.probes) || manifest.probes.length === 0) {
    throw new Error('Geo tuning probe manifest requires at least one probe.');
  }

  for (const probe of manifest.probes) {
    if (
      !probe.name ||
      !Number.isFinite(probe.lon) ||
      !Number.isFinite(probe.lat) ||
      !probe.expectedVerdict ||
      !probe.expectedReason
    ) {
      throw new Error(`Invalid geo tuning probe: ${JSON.stringify(probe)}`);
    }
  }

  return manifest;
}

async function validateProbe(
  client: postgres.Sql,
  probe: TuningProbe,
): Promise<GeoValidationResult> {
  const rows = await client<{ result: GeoValidationResult }[]>`
    SELECT geo_validate_position(${probe.lon}, ${probe.lat}) AS result
  `;
  const result = rows[0]?.result;
  if (!result) {
    throw new Error(`geo_validate_position returned no result for ${probe.name}`);
  }
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  });
}
