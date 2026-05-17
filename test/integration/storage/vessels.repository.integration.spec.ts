import postgres, { Sql } from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import { ConfigService } from '../../../src/shared/config/config.service';
import {
  stubCounter,
  stubHistogram,
  stubPinoLogger,
} from '../../../src/shared/testing/metrics-stubs';
import { PositionEvent, SCHEMA_VERSION, StaticEvent } from '../../../src/contracts';
import { VesselsRepository } from '../../../src/storage/vessels.repository';
import { createPartitionSql, utcDayStart } from '../../../src/storage/history-partitions';
import { assertIntegrationDatabase } from '../setup/testcontainers-postgres';

const TEST_RETENTION_DAYS = 7;

function makeConfig(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'HISTORY_RETENTION_DAYS') return TEST_RETENTION_DAYS;
      throw new Error(`unexpected config key ${key}`);
    }),
  } as unknown as ConfigService;
}

function makeRepository(db: PostgresJsDatabase): VesselsRepository {
  return new VesselsRepository(
    { db } as never,
    makeConfig(),
    stubHistogram(),
    stubCounter(),
    stubCounter(),
    stubPinoLogger(),
  );
}

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function positionEvent(overrides: Partial<PositionEvent> = {}): PositionEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'position',
    mmsi: '241935000',
    lat: 41.5,
    lon: 41.5,
    sog: 0.1,
    cog: 26.9,
    trueHeading: 261,
    navStatus: 5,
    rateOfTurn: 0,
    shipName: 'SEA MOON',
    occurredAt: isoMinutesFromNow(-5),
    provider: 'aisstream',
    ingestedAt: isoMinutesFromNow(0),
    traceId: '11111111-2222-4333-8444-555555555555',
    ...overrides,
  };
}

function staticEvent(overrides: Partial<StaticEvent> = {}): StaticEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'static',
    mmsi: '241935000',
    imo: '9187629',
    name: 'SEA MOON',
    callSign: 'SVMN',
    shipType: 70,
    destination: 'PIRAEUS',
    dimensionToBow: 85,
    dimensionToStern: 15,
    dimensionToPort: 8,
    dimensionToStarboard: 9,
    occurredAt: isoMinutesFromNow(-5),
    provider: 'aisstream',
    ingestedAt: isoMinutesFromNow(0),
    traceId: '11111111-2222-4333-8444-555555555555',
    ...overrides,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function expectPresent<T>(value: T | null | undefined, label: string): asserts value is T {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error(`${label} was not found`);
  }
}

async function assertPostgisAvailable(client: Sql): Promise<void> {
  try {
    const rows = await client<{ version: string }[]>`
      SELECT PostGIS_Version() AS version
    `;
    if (!rows[0]?.version) {
      throw new Error('PostGIS_Version() returned no version');
    }
  } catch (err) {
    throw new Error(
      'VesselsRepository integration tests require a reachable PostgreSQL/PostGIS test DB. ' +
        'The Jest integration global setup should start Testcontainers and run migrations before this suite. ' +
        `Original error: ${(err as Error).message}`,
    );
  }
}

async function assertMigrated(client: Sql): Promise<void> {
  const rows = await client<{ table_name: string | null }[]>`
    SELECT to_regclass('public.vessels')::text AS table_name
    UNION ALL
    SELECT to_regclass('public.vessel_positions_latest')::text AS table_name
    UNION ALL
    SELECT to_regclass('public.vessel_positions_history')::text AS table_name
  `;
  const existing = rows
    .map((row) => row.table_name)
    .filter((name): name is string => name !== null);
  const required = ['vessel_positions_history', 'vessel_positions_latest', 'vessels'];
  const missing = required.filter((table) => !existing.includes(table));
  if (missing.length > 0) {
    throw new Error(
      'VesselsRepository integration tests require the normal project migrations to be applied. ' +
        `Missing tables: ${missing.join(', ')}.`,
    );
  }
}

async function resetData(client: Sql): Promise<void> {
  await client`
    TRUNCATE TABLE vessel_positions_history, vessel_positions_latest, vessels
    RESTART IDENTITY CASCADE
  `;
}

async function ensureHistoryPartitions(db: PostgresJsDatabase, occurredAts: readonly string[]) {
  const days = new Map<string, Date>();
  for (const occurredAt of occurredAts) {
    const day = utcDayStart(new Date(occurredAt));
    days.set(day.toISOString(), day);
  }

  for (const day of days.values()) {
    await db.execute(drizzleSql.raw(createPartitionSql(day)));
  }
}

async function tableCounts(client: Sql) {
  const rows = await client<
    {
      vessels: number;
      latest: number;
      history: number;
    }[]
  >`
    SELECT
      (SELECT COUNT(*)::int FROM vessels) AS vessels,
      (SELECT COUNT(*)::int FROM vessel_positions_latest) AS latest,
      (SELECT COUNT(*)::int FROM vessel_positions_history) AS history
  `;
  const row = rows[0];
  if (!row) throw new Error('failed to read table counts');
  return row;
}

async function latestPosition(client: Sql, mmsi: string) {
  const rows = await client<
    Array<{
      vesselId: string;
      mmsi: string;
      lon: number;
      lat: number;
      sog: number | null;
      cog: number | null;
      trueHeading: number | null;
      navStatus: number | null;
      rateOfTurn: number | null;
      occurredAt: Date;
    }>
  >`
    SELECT
      p.vessel_id AS "vesselId",
      p.mmsi,
      ST_X(p.position::geometry)::float8 AS lon,
      ST_Y(p.position::geometry)::float8 AS lat,
      p.sog,
      p.cog,
      p.true_heading AS "trueHeading",
      p.nav_status AS "navStatus",
      p.rate_of_turn AS "rateOfTurn",
      p.occurred_at AS "occurredAt"
    FROM vessel_positions_latest p
    WHERE p.mmsi = ${mmsi}
  `;
  return rows[0] ?? null;
}

async function historyPositions(client: Sql, mmsi: string) {
  return client<
    Array<{
      vesselId: string;
      mmsi: string;
      lon: number;
      lat: number;
      sog: number | null;
      cog: number | null;
      trueHeading: number | null;
      navStatus: number | null;
      rateOfTurn: number | null;
      occurredAt: Date;
    }>
  >`
    SELECT
      vessel_id AS "vesselId",
      mmsi,
      ST_X(position::geometry)::float8 AS lon,
      ST_Y(position::geometry)::float8 AS lat,
      sog,
      cog,
      true_heading AS "trueHeading",
      nav_status AS "navStatus",
      rate_of_turn AS "rateOfTurn",
      occurred_at AS "occurredAt"
    FROM vessel_positions_history
    WHERE mmsi = ${mmsi}
    ORDER BY occurred_at ASC
  `;
}

async function vesselProfile(client: Sql, mmsi: string) {
  const rows = await client<
    Array<{
      id: string;
      mmsi: string;
      imo: string | null;
      name: string | null;
      callSign: string | null;
      shipType: number | null;
      destination: string | null;
      dimensionToBow: number | null;
      dimensionToStern: number | null;
      dimensionToPort: number | null;
      dimensionToStarboard: number | null;
    }>
  >`
    SELECT
      id,
      mmsi,
      imo,
      name,
      call_sign AS "callSign",
      ship_type AS "shipType",
      destination,
      dimension_to_bow AS "dimensionToBow",
      dimension_to_stern AS "dimensionToStern",
      dimension_to_port AS "dimensionToPort",
      dimension_to_starboard AS "dimensionToStarboard"
    FROM vessels
    WHERE mmsi = ${mmsi}
  `;
  return rows[0] ?? null;
}

describe('VesselsRepository DB integration', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL was not provided by Jest integration global setup.');
  }
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const db = drizzle(client);
  let repo: VesselsRepository;

  beforeAll(async () => {
    assertIntegrationDatabase(databaseUrl);
    await assertPostgisAvailable(client);
    await assertMigrated(client);
    repo = makeRepository(db);
  });

  beforeEach(async () => {
    await resetData(client);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  describe('upsertPosition', () => {
    it('inserts vessel, latest position, and history for a fresh position', async () => {
      const event = positionEvent({
        mmsi: '241935000',
        lon: 30.25,
        lat: 44.75,
        sog: 12.3,
        cog: 91.5,
        trueHeading: 92,
        navStatus: 0,
        rateOfTurn: 1.2,
        shipName: 'SEA MOON',
        occurredAt: isoMinutesFromNow(-4),
      });
      await ensureHistoryPartitions(db, [event.occurredAt]);

      const result = await repo.upsertPosition(event);
      expectPresent(result, 'upsertPosition result');

      expect(result).toEqual({
        vesselId: expect.any(String),
        mmsi: '241935000',
        imo: null,
        name: 'SEA MOON',
      });
      await expect(tableCounts(client)).resolves.toEqual({ vessels: 1, latest: 1, history: 1 });

      const latest = await latestPosition(client, event.mmsi);
      expectPresent(latest, 'latest position');
      expect(latest).toMatchObject({
        vesselId: result.vesselId,
        mmsi: event.mmsi,
        lon: event.lon,
        lat: event.lat,
        sog: event.sog,
        cog: event.cog,
        trueHeading: event.trueHeading,
        navStatus: event.navStatus,
        rateOfTurn: event.rateOfTurn,
      });
      expect(toIso(latest.occurredAt)).toBe(event.occurredAt);

      const history = await historyPositions(client, event.mmsi);
      expect(history).toHaveLength(1);
      const [historyRow] = history;
      expectPresent(historyRow, 'history position');
      expect(historyRow).toMatchObject({
        vesselId: result.vesselId,
        mmsi: event.mmsi,
        lon: event.lon,
        lat: event.lat,
        sog: event.sog,
        cog: event.cog,
        trueHeading: event.trueHeading,
        navStatus: event.navStatus,
        rateOfTurn: event.rateOfTurn,
      });
      expect(toIso(historyRow.occurredAt)).toBe(event.occurredAt);
    });

    it('does not duplicate history when the same vessel timestamp is replayed', async () => {
      const event = positionEvent({ mmsi: '241935001', occurredAt: isoMinutesFromNow(-3) });
      await ensureHistoryPartitions(db, [event.occurredAt]);

      const first = await repo.upsertPosition(event);
      const replay = await repo.upsertPosition(event);

      expect(replay).toEqual(first);
      await expect(tableCounts(client)).resolves.toEqual({ vessels: 1, latest: 1, history: 1 });
      await expect(historyPositions(client, event.mmsi)).resolves.toHaveLength(1);
    });

    it('keeps latest on the newest position while appending older out-of-order history', async () => {
      const newer = positionEvent({
        mmsi: '241935002',
        lon: 31,
        lat: 45,
        sog: 15,
        occurredAt: isoMinutesFromNow(-2),
      });
      const older = positionEvent({
        mmsi: '241935002',
        lon: 29,
        lat: 43,
        sog: 5,
        occurredAt: isoMinutesFromNow(-10),
      });
      await ensureHistoryPartitions(db, [newer.occurredAt, older.occurredAt]);

      await repo.upsertPosition(newer);
      await repo.upsertPosition(older);

      const latest = await latestPosition(client, newer.mmsi);
      expectPresent(latest, 'latest position');
      expect(latest).toMatchObject({ lon: newer.lon, lat: newer.lat, sog: newer.sog });
      expect(toIso(latest.occurredAt)).toBe(newer.occurredAt);

      const history = await historyPositions(client, newer.mmsi);
      expect(history).toHaveLength(2);
      expect(history.map((row) => toIso(row.occurredAt))).toEqual([
        older.occurredAt,
        newer.occurredAt,
      ]);
      expect(history.map((row) => [row.lon, row.lat])).toEqual([
        [older.lon, older.lat],
        [newer.lon, newer.lat],
      ]);
    });

    it('updates latest when a newer position arrives', async () => {
      const older = positionEvent({
        mmsi: '241935003',
        lon: 28.1,
        lat: 42.1,
        sog: 3.5,
        occurredAt: isoMinutesFromNow(-12),
      });
      const newer = positionEvent({
        mmsi: '241935003',
        lon: 32.2,
        lat: 46.2,
        sog: 18.5,
        cog: 120,
        trueHeading: 121,
        navStatus: 1,
        occurredAt: isoMinutesFromNow(-1),
      });
      await ensureHistoryPartitions(db, [older.occurredAt, newer.occurredAt]);

      await repo.upsertPosition(older);
      await repo.upsertPosition(newer);

      const latest = await latestPosition(client, newer.mmsi);
      expectPresent(latest, 'latest position');
      expect(latest).toMatchObject({
        lon: newer.lon,
        lat: newer.lat,
        sog: newer.sog,
        cog: newer.cog,
        trueHeading: newer.trueHeading,
        navStatus: newer.navStatus,
      });
      expect(toIso(latest.occurredAt)).toBe(newer.occurredAt);
      await expect(historyPositions(client, newer.mmsi)).resolves.toHaveLength(2);
    });

    it('drops stale position telemetry before any DB write', async () => {
      const result = await repo.upsertPosition(
        positionEvent({
          mmsi: '241935004',
          occurredAt: '2000-01-01T00:00:00.000Z',
        }),
      );

      expect(result).toBeNull();
      await expect(tableCounts(client)).resolves.toEqual({ vessels: 0, latest: 0, history: 0 });
    });
  });

  describe('upsertProfile', () => {
    it('creates a vessel profile and returns the persisted summary', async () => {
      const event = staticEvent({
        mmsi: '241935100',
        imo: '9187629',
        name: 'SEA MOON',
        callSign: 'SVMN',
        shipType: 70,
        destination: 'PIRAEUS',
        occurredAt: isoMinutesFromNow(-4),
      });

      const result = await repo.upsertProfile(event);
      expectPresent(result, 'upsertProfile result');

      expect(result).toEqual({
        vesselId: expect.any(String),
        mmsi: event.mmsi,
        imo: event.imo,
        name: event.name,
      });
      await expect(tableCounts(client)).resolves.toEqual({ vessels: 1, latest: 0, history: 0 });
      const profile = await vesselProfile(client, event.mmsi);
      expectPresent(profile, 'vessel profile');
      expect(profile).toMatchObject({
        id: result.vesselId,
        mmsi: event.mmsi,
        imo: event.imo,
        name: event.name,
        callSign: event.callSign,
        shipType: event.shipType,
        destination: event.destination,
        dimensionToBow: event.dimensionToBow,
        dimensionToStern: event.dimensionToStern,
        dimensionToPort: event.dimensionToPort,
        dimensionToStarboard: event.dimensionToStarboard,
      });
    });

    it('updates non-null fields and preserves existing values when incoming fields are null', async () => {
      const initial = staticEvent({
        mmsi: '241935101',
        imo: '9187629',
        name: 'SEA MOON',
        callSign: 'SVMN',
        shipType: 70,
        destination: 'PIRAEUS',
        dimensionToBow: 85,
        dimensionToStern: 15,
        dimensionToPort: 8,
        dimensionToStarboard: 9,
        occurredAt: isoMinutesFromNow(-6),
      });
      const update = staticEvent({
        mmsi: initial.mmsi,
        imo: '9321483',
        name: 'SEA MOON II',
        callSign: 'SMN2',
        shipType: 80,
        destination: 'ISTANBUL',
        dimensionToBow: 90,
        dimensionToStern: 20,
        dimensionToPort: 10,
        dimensionToStarboard: 11,
        occurredAt: isoMinutesFromNow(-5),
      });
      const partialNullUpdate = staticEvent({
        mmsi: initial.mmsi,
        imo: null,
        name: null,
        callSign: null,
        shipType: null,
        destination: null,
        dimensionToBow: null,
        dimensionToStern: null,
        dimensionToPort: null,
        dimensionToStarboard: null,
        occurredAt: isoMinutesFromNow(-4),
      });

      await repo.upsertProfile(initial);
      const updateResult = await repo.upsertProfile(update);
      const nullUpdateResult = await repo.upsertProfile(partialNullUpdate);
      expectPresent(updateResult, 'updated vessel profile result');
      expectPresent(nullUpdateResult, 'partial-null vessel profile result');

      expect(nullUpdateResult).toEqual({
        vesselId: updateResult.vesselId,
        mmsi: update.mmsi,
        imo: update.imo,
        name: update.name,
      });
      const profile = await vesselProfile(client, initial.mmsi);
      expectPresent(profile, 'vessel profile');
      expect(profile).toMatchObject({
        id: updateResult.vesselId,
        mmsi: update.mmsi,
        imo: update.imo,
        name: update.name,
        callSign: update.callSign,
        shipType: update.shipType,
        destination: update.destination,
        dimensionToBow: update.dimensionToBow,
        dimensionToStern: update.dimensionToStern,
        dimensionToPort: update.dimensionToPort,
        dimensionToStarboard: update.dimensionToStarboard,
      });
      await expect(tableCounts(client)).resolves.toEqual({ vessels: 1, latest: 0, history: 0 });
    });

    it('drops stale static telemetry before any DB write', async () => {
      const result = await repo.upsertProfile(
        staticEvent({
          mmsi: '241935102',
          occurredAt: '2000-01-01T00:00:00.000Z',
        }),
      );

      expect(result).toBeNull();
      await expect(tableCounts(client)).resolves.toEqual({ vessels: 0, latest: 0, history: 0 });
    });
  });
});
