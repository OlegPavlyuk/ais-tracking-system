import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../shared/db/db.service';
import { Bbox } from '../shared/config/constants';
import { PositionEvent, StaticEvent } from '../contracts';

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
          SET name = COALESCE(vessels.name, EXCLUDED.name),
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

  /**
   * Upserts profile fields onto `vessels` from a static event. Existing
   * non-null values are preserved when the incoming field is null (COALESCE
   * over EXCLUDED), so a partial Type 24 Part-A message does not erase
   * IMO/dimensions previously learned from a Type 5.
   */
  async upsertProfile(event: StaticEvent): Promise<void> {
    await this.dbs.db.execute(sql`
      INSERT INTO vessels (
        mmsi, imo, name, call_sign, ship_type, destination,
        dimension_to_bow, dimension_to_stern, dimension_to_port, dimension_to_starboard,
        updated_at
      )
      VALUES (
        ${event.mmsi},
        ${event.imo ?? null},
        ${event.name ?? null},
        ${event.callSign ?? null},
        ${event.shipType ?? null},
        ${event.destination ?? null},
        ${event.dimensionToBow ?? null},
        ${event.dimensionToStern ?? null},
        ${event.dimensionToPort ?? null},
        ${event.dimensionToStarboard ?? null},
        NOW()
      )
      ON CONFLICT (mmsi) DO UPDATE
        SET imo                    = COALESCE(EXCLUDED.imo,                    vessels.imo),
            name                   = COALESCE(EXCLUDED.name,                   vessels.name),
            call_sign              = COALESCE(EXCLUDED.call_sign,              vessels.call_sign),
            ship_type              = COALESCE(EXCLUDED.ship_type,              vessels.ship_type),
            destination            = COALESCE(EXCLUDED.destination,            vessels.destination),
            dimension_to_bow       = COALESCE(EXCLUDED.dimension_to_bow,       vessels.dimension_to_bow),
            dimension_to_stern     = COALESCE(EXCLUDED.dimension_to_stern,     vessels.dimension_to_stern),
            dimension_to_port      = COALESCE(EXCLUDED.dimension_to_port,      vessels.dimension_to_port),
            dimension_to_starboard = COALESCE(EXCLUDED.dimension_to_starboard, vessels.dimension_to_starboard),
            updated_at             = NOW()
    `);
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

  /** Full vessel profile + current position, or null when the id is unknown. */
  async findById(id: string): Promise<VesselDetailRow | null> {
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
      position,
    };
  }
}
