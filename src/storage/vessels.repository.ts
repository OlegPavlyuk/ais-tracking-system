import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../shared/db/db.service';
import { Bbox } from '../shared/config/constants';
import { PositionEvent } from '../contracts';

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
}

@Injectable()
export class VesselsRepository {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  /**
   * Upserts the vessel row (creating on first sight) and the latest position
   * row in a single transaction. History writes land in slice #5.
   */
  async upsertPosition(event: PositionEvent): Promise<void> {
    const db = this.dbs.db;
    await db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO vessels (mmsi, name, updated_at)
        VALUES (${event.mmsi}, ${event.shipName ?? null}, NOW())
        ON CONFLICT (mmsi) DO UPDATE
          SET name = COALESCE(EXCLUDED.name, vessels.name),
              updated_at = NOW()
        RETURNING id
      `);
      const row = (inserted as unknown as Array<{ id: string }>)[0];
      if (!row) throw new Error(`vessels upsert returned no row for mmsi=${event.mmsi}`);

      await tx.execute(sql`
        INSERT INTO vessel_positions_latest (
          vessel_id, mmsi, position, sog, cog, true_heading, nav_status, rate_of_turn, occurred_at, last_seen_at
        )
        VALUES (
          ${row.id},
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
    });
  }

  /** Snapshot of vessels in a bbox, joined to profile, filtered by `last_seen_at`. */
  async findInBbox(bbox: Bbox, sinceMs: number, limit: number): Promise<VesselSnapshotRow[]> {
    const since = new Date(Date.now() - sinceMs).toISOString();
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
        p.last_seen_at    AS "lastSeenAt"
      FROM vessel_positions_latest p
      JOIN vessels v ON v.id = p.vessel_id
      WHERE p.position && ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326)
        AND p.last_seen_at >= ${since}
      ORDER BY p.last_seen_at DESC
      LIMIT ${limit}
    `);
    return rows as unknown as VesselSnapshotRow[];
  }
}
