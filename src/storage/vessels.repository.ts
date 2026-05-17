import { Inject, Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '../shared/config/config.service';
import { DbService } from '../shared/db/db.service';
import { Bbox } from '../shared/config/constants';
import {
  DB_QUERY_DURATION_SECONDS,
  DB_WRITES_TOTAL,
  HISTORY_EVENTS_DROPPED_TOTAL,
} from '../shared/metrics/metric-names';
import { PositionEvent, StaticEvent } from '../contracts';
import {
  HISTORY_RETENTION_SAFETY_DAYS,
  historyRetentionCutoffDay,
  isHistoryEventRetained,
} from './history-partitions';
import { vessels } from './schema';

export interface VesselSnapshotRow {
  id: string;
  mmsi: string;
  imo: string | null;
  name: string | null;
  callSign: string | null;
  shipType: number | null;
  lon: number;
  lat: number;
  sog: number | null;
  cog: number | null;
  trueHeading: number | null;
  navStatus: number | null;
  occurredAt: string;
  lastSeenAt: string;
  sanctionsStatus: 'clear' | 'candidate' | 'sanctioned' | null;
  sanctionsCheckedAt: string | null;
}

export interface TrackPoint {
  lon: number;
  lat: number;
  occurredAt: string;
  sog: number | null;
  cog: number | null;
  navStatus: number | null;
}

export type TrackResult =
  | { kind: 'points'; points: TrackPoint[] }
  | { kind: 'linestring'; coordinates: [number, number][] };

export interface VesselSanctionMatch {
  entityId: string;
  source: string;
  sourceEntityId: string;
  name: string;
  matchMethod: 'imo' | 'mmsi' | 'name_candidate';
  aliases: string[];
  flag: string | null;
  listingDate: string | null;
  programs?: string[];
}

export interface VesselDetailRow {
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
  sanctionsStatus: 'clear' | 'candidate' | 'sanctioned' | null;
  sanctionsCheckedAt: string | null;
  sanctionsMatches: VesselSanctionMatch[];
  position: {
    lon: number;
    lat: number;
    sog: number | null;
    cog: number | null;
    trueHeading: number | null;
    navStatus: number | null;
    rateOfTurn: number | null;
    occurredAt: string;
    lastSeenAt: string;
  } | null;
}

export interface PersistedVesselSummary {
  vesselId: string;
  mmsi: string;
  imo: string | null;
  name: string | null;
}

type VesselSummaryRow = {
  id: string;
  mmsi: string;
  imo: string | null;
  name: string | null;
};
type DbTransaction = Parameters<Parameters<DbService['db']['transaction']>[0]>[0];

@Injectable()
export class VesselsRepository {
  constructor(
    @Inject(DbService) private readonly dbs: DbService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectMetric(DB_QUERY_DURATION_SECONDS)
    private readonly queryDuration: Histogram<'query'>,
    @InjectMetric(DB_WRITES_TOTAL)
    private readonly writes: Counter<'table'>,
    @InjectMetric(HISTORY_EVENTS_DROPPED_TOTAL)
    private readonly historyDropped: Counter<'reason'>,
    private readonly pino: PinoLogger,
  ) {
    this.pino.setContext(VesselsRepository.name);
  }

  private async timed<T>(query: string, fn: () => Promise<T>): Promise<T> {
    const end = this.queryDuration.startTimer({ query });
    try {
      return await fn();
    } finally {
      end();
    }
  }

  async upsertPosition(event: PositionEvent): Promise<PersistedVesselSummary | null> {
    const db = this.dbs.db;
    if (this.dropIfStaleTelemetry(event)) return null;

    const summary = await this.timed('vessels.upsertPosition', () =>
      db.transaction(async (tx) => {
        const row = await this.upsertVesselFromPosition(tx, event);
        await this.upsertLatestPosition(tx, row.id, event);
        await this.insertPositionHistory(tx, row.id, event);
        return this.toPersistedVesselSummary(row);
      }),
    );
    this.writes.inc({ table: 'vessels' });
    this.writes.inc({ table: 'vessel_positions_latest' });
    this.writes.inc({ table: 'vessel_positions_history' });
    return summary;
  }

  private async upsertVesselFromPosition(
    tx: DbTransaction,
    event: PositionEvent,
  ): Promise<VesselSummaryRow> {
    const rows = await tx
      .insert(vessels)
      .values({
        mmsi: event.mmsi,
        name: event.shipName ?? null,
        updatedAt: sql`NOW()`,
      })
      .onConflictDoUpdate({
        target: vessels.mmsi,
        set: {
          name: sql`COALESCE(${vessels.name}, EXCLUDED.name)`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({
        id: vessels.id,
        mmsi: vessels.mmsi,
        imo: vessels.imo,
        name: vessels.name,
      });
    const row = rows[0];
    if (!row) throw new Error(`vessels upsert returned no row for mmsi=${event.mmsi}`);
    return row;
  }

  private async upsertLatestPosition(
    tx: DbTransaction,
    vesselId: string,
    event: PositionEvent,
  ): Promise<void> {
    await tx.execute(sql`
        INSERT INTO vessel_positions_latest (
          vessel_id, mmsi, position, sog, cog, true_heading, nav_status, rate_of_turn, occurred_at, last_seen_at
        )
        VALUES (
          ${vesselId},
          ${event.mmsi},
          ST_SetSRID(ST_MakePoint(${event.lon}, ${event.lat}), 4326),
          ${event.sog ?? null},
          ${event.cog ?? null},
          ${event.trueHeading ?? null},
          ${event.navStatus ?? null},
          ${event.rateOfTurn ?? null},
          ${event.occurredAt},
          NOW()
        )
        ON CONFLICT (vessel_id) DO UPDATE
          SET position = EXCLUDED.position,
              sog = EXCLUDED.sog,
              cog = EXCLUDED.cog,
              true_heading = EXCLUDED.true_heading,
              nav_status = EXCLUDED.nav_status,
              rate_of_turn = EXCLUDED.rate_of_turn,
              occurred_at = EXCLUDED.occurred_at,
              last_seen_at = NOW()
          WHERE vessel_positions_latest.occurred_at <= EXCLUDED.occurred_at
      `);
  }

  private async insertPositionHistory(
    tx: DbTransaction,
    vesselId: string,
    event: PositionEvent,
  ): Promise<void> {
    await tx.execute(sql`
          INSERT INTO vessel_positions_history (
            vessel_id, mmsi, position, sog, cog, true_heading, nav_status, rate_of_turn, occurred_at
          )
          VALUES (
            ${vesselId},
            ${event.mmsi},
            ST_SetSRID(ST_MakePoint(${event.lon}, ${event.lat}), 4326),
            ${event.sog ?? null},
            ${event.cog ?? null},
            ${event.trueHeading ?? null},
            ${event.navStatus ?? null},
            ${event.rateOfTurn ?? null},
            ${event.occurredAt}
          )
          ON CONFLICT (vessel_id, occurred_at) DO NOTHING
        `);
  }

  async findTrack(
    vesselId: string,
    from: Date,
    to: Date,
    simplifyMeters?: number,
  ): Promise<TrackResult> {
    return this.timed('vessels.findTrack', () =>
      this.findTrackInner(vesselId, from, to, simplifyMeters),
    );
  }

  private async findTrackInner(
    vesselId: string,
    from: Date,
    to: Date,
    simplifyMeters?: number,
  ): Promise<TrackResult> {
    if (simplifyMeters !== undefined) {
      const rows = await this.dbs.db.execute(sql`
        SELECT ST_AsGeoJSON(
          ST_Transform(
            ST_SimplifyPreserveTopology(
              ST_Transform(ST_MakeLine(position ORDER BY occurred_at ASC), 3857),
              ${simplifyMeters}
            ),
            4326
          )
        )::text AS geojson
        FROM vessel_positions_history
        WHERE vessel_id = ${vesselId}
          AND occurred_at >= ${from.toISOString()}
          AND occurred_at <  ${to.toISOString()}
        HAVING COUNT(*) >= 2
      `);
      const row = (rows as unknown as Array<{ geojson: string | null }>)[0];
      if (!row || !row.geojson) {
        return { kind: 'linestring', coordinates: [] };
      }
      try {
        const geom = JSON.parse(row.geojson) as { coordinates?: unknown };
        const coords = Array.isArray(geom.coordinates)
          ? (geom.coordinates as [number, number][])
          : [];
        return { kind: 'linestring', coordinates: coords };
      } catch {
        return { kind: 'linestring', coordinates: [] };
      }
    }

    const rows = await this.dbs.db.execute(sql`
      SELECT
        ST_X(position::geometry) AS lon,
        ST_Y(position::geometry) AS lat,
        sog,
        cog,
        nav_status   AS "navStatus",
        occurred_at  AS "occurredAt"
      FROM vessel_positions_history
      WHERE vessel_id = ${vesselId}
        AND occurred_at >= ${from.toISOString()}
        AND occurred_at <  ${to.toISOString()}
      ORDER BY occurred_at ASC
    `);
    const points = (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      lon: r.lon as number,
      lat: r.lat as number,
      occurredAt:
        r.occurredAt instanceof Date ? r.occurredAt.toISOString() : (r.occurredAt as string),
      sog: r.sog as number | null,
      cog: r.cog as number | null,
      navStatus: r.navStatus as number | null,
    }));
    return { kind: 'points', points };
  }

  async upsertProfile(event: StaticEvent): Promise<PersistedVesselSummary | null> {
    if (this.dropIfStaleTelemetry(event)) return null;

    const rows = await this.timed('vessels.upsertProfile', () =>
      this.dbs.db
        .insert(vessels)
        .values({
          mmsi: event.mmsi,
          imo: event.imo ?? null,
          name: event.name ?? null,
          callSign: event.callSign ?? null,
          shipType: event.shipType ?? null,
          destination: event.destination ?? null,
          dimensionToBow: event.dimensionToBow ?? null,
          dimensionToStern: event.dimensionToStern ?? null,
          dimensionToPort: event.dimensionToPort ?? null,
          dimensionToStarboard: event.dimensionToStarboard ?? null,
          updatedAt: sql`NOW()`,
        })
        .onConflictDoUpdate({
          target: vessels.mmsi,
          set: {
            imo: sql`COALESCE(EXCLUDED.imo, ${vessels.imo})`,
            name: sql`COALESCE(EXCLUDED.name, ${vessels.name})`,
            callSign: sql`COALESCE(EXCLUDED.call_sign, ${vessels.callSign})`,
            shipType: sql`COALESCE(EXCLUDED.ship_type, ${vessels.shipType})`,
            destination: sql`COALESCE(EXCLUDED.destination, ${vessels.destination})`,
            dimensionToBow: sql`COALESCE(EXCLUDED.dimension_to_bow, ${vessels.dimensionToBow})`,
            dimensionToStern: sql`COALESCE(EXCLUDED.dimension_to_stern, ${vessels.dimensionToStern})`,
            dimensionToPort: sql`COALESCE(EXCLUDED.dimension_to_port, ${vessels.dimensionToPort})`,
            dimensionToStarboard: sql`COALESCE(EXCLUDED.dimension_to_starboard, ${vessels.dimensionToStarboard})`,
            updatedAt: sql`NOW()`,
          },
        })
        .returning({
          id: vessels.id,
          mmsi: vessels.mmsi,
          imo: vessels.imo,
          name: vessels.name,
        }),
    );
    const row = rows[0];
    if (!row) throw new Error(`vessels profile upsert returned no row for mmsi=${event.mmsi}`);
    this.writes.inc({ table: 'vessels' });
    return this.toPersistedVesselSummary(row);
  }

  private toPersistedVesselSummary(row: VesselSummaryRow): PersistedVesselSummary {
    return {
      vesselId: row.id,
      mmsi: row.mmsi,
      imo: row.imo,
      name: row.name,
    };
  }

  private dropIfStaleTelemetry(event: PositionEvent | StaticEvent): boolean {
    const now = new Date();
    const retentionPolicy = {
      retentionDays: this.config.get('HISTORY_RETENTION_DAYS'),
      safetyDays: HISTORY_RETENTION_SAFETY_DAYS,
    };
    if (isHistoryEventRetained(event.occurredAt, now, retentionPolicy)) return false;

    this.historyDropped.inc({ reason: 'too_old' });
    this.pino.warn(
      {
        mmsi: event.mmsi,
        occurredAt: event.occurredAt,
        retentionCutoff: historyRetentionCutoffDay(now, retentionPolicy).toISOString(),
        traceId: event.traceId,
        kind: event.kind,
        reason: 'too_old',
      },
      'dropped stale telemetry outside retention window',
    );
    return true;
  }

  /** Latest snapshot in supported coverage, joined to profile, filtered by `last_seen_at`. */
  async findLatestInBboxes(
    bboxes: readonly Bbox[],
    sinceMs: number,
    limit: number,
  ): Promise<VesselSnapshotRow[]> {
    if (bboxes.length === 0) return [];
    const since = new Date(Date.now() - sinceMs).toISOString();
    const bboxConditions = bboxes.map(
      (bbox) => sql`
      p.position && ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326)
    `,
    );

    return this.timed('vessels.findLatestInBboxes', async () => {
      const rows = await this.dbs.db.execute(sql`
        SELECT
          v.id,
          v.mmsi,
          v.imo,
          v.name,
          v.call_sign       AS "callSign",
          v.ship_type       AS "shipType",
          ST_X(p.position::geometry) AS lon,
          ST_Y(p.position::geometry) AS lat,
          p.sog,
          p.cog,
          p.true_heading    AS "trueHeading",
          p.nav_status      AS "navStatus",
          p.occurred_at     AS "occurredAt",
          p.last_seen_at    AS "lastSeenAt",
          v.sanctions_status     AS "sanctionsStatus",
          v.sanctions_checked_at AS "sanctionsCheckedAt"
        FROM vessel_positions_latest p
        JOIN vessels v ON v.id = p.vessel_id
        WHERE p.last_seen_at >= ${since}
          AND (${sql.join(bboxConditions, sql` OR `)})
        ORDER BY p.last_seen_at DESC
        LIMIT ${limit}
      `);
      return rows as unknown as VesselSnapshotRow[];
    });
  }

  /** Full vessel profile + current position, or null when the id is unknown. */
  async findById(id: string): Promise<VesselDetailRow | null> {
    return this.timed('vessels.findById', () => this.findByIdInner(id));
  }

  private async findByIdInner(id: string): Promise<VesselDetailRow | null> {
    const rows = await this.dbs.db.execute(sql`
      SELECT
        v.id,
        v.mmsi,
        v.imo,
        v.name,
        v.call_sign              AS "callSign",
        v.ship_type              AS "shipType",
        v.destination,
        v.dimension_to_bow       AS "dimensionToBow",
        v.dimension_to_stern     AS "dimensionToStern",
        v.dimension_to_port      AS "dimensionToPort",
        v.dimension_to_starboard AS "dimensionToStarboard",
        v.sanctions_status       AS "sanctionsStatus",
        v.sanctions_checked_at   AS "sanctionsCheckedAt",
        v.sanctions_matches      AS "sanctionsMatches",
        ST_X(p.position::geometry) AS lon,
        ST_Y(p.position::geometry) AS lat,
        p.sog,
        p.cog,
        p.true_heading           AS "trueHeading",
        p.nav_status             AS "navStatus",
        p.rate_of_turn           AS "rateOfTurn",
        p.occurred_at            AS "occurredAt",
        p.last_seen_at           AS "lastSeenAt"
      FROM vessels v
      LEFT JOIN vessel_positions_latest p ON p.vessel_id = v.id
      WHERE v.id = ${id}
      LIMIT 1
    `);
    const row = (rows as unknown as Array<Record<string, unknown>>)[0];
    if (!row) return null;
    const lon = row.lon as number | null;
    const lat = row.lat as number | null;
    const position =
      lon !== null && lat !== null
        ? {
            lon,
            lat,
            sog: row.sog as number | null,
            cog: row.cog as number | null,
            trueHeading: row.trueHeading as number | null,
            navStatus: row.navStatus as number | null,
            rateOfTurn: row.rateOfTurn as number | null,
            occurredAt: row.occurredAt as string,
            lastSeenAt: row.lastSeenAt as string,
          }
        : null;
    const checkedAt = row.sanctionsCheckedAt;
    return {
      id: row.id as string,
      mmsi: row.mmsi as string,
      imo: row.imo as string | null,
      name: row.name as string | null,
      callSign: row.callSign as string | null,
      shipType: row.shipType as number | null,
      destination: row.destination as string | null,
      dimensionToBow: row.dimensionToBow as number | null,
      dimensionToStern: row.dimensionToStern as number | null,
      dimensionToPort: row.dimensionToPort as number | null,
      dimensionToStarboard: row.dimensionToStarboard as number | null,
      sanctionsStatus: (row.sanctionsStatus as VesselDetailRow['sanctionsStatus']) ?? null,
      sanctionsCheckedAt:
        checkedAt === null || checkedAt === undefined
          ? null
          : checkedAt instanceof Date
            ? checkedAt.toISOString()
            : new Date(checkedAt as string).toISOString(),
      sanctionsMatches: (row.sanctionsMatches as VesselSanctionMatch[] | null) ?? [],
      position,
    };
  }
}
