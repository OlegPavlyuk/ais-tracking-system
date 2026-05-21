import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  smallint,
  doublePrecision,
  geometry,
  text,
  jsonb,
  bigserial,
  integer,
  date,
  boolean,
  customType,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle ORM 0.45.2 accepts a geometry type option at the type level, but its
 * native PostGIS column implementation still emits geometry(point). Geo import
 * tables intentionally accept mixed Polygon/MultiPolygon/GeometryCollection
 * output from ST_MakeValid/ST_Subdivide, so keep this explicit generic geometry
 * custom type until native non-point PostGIS columns are represented correctly.
 */
const geoGeometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Geometry, 4326)';
  },
});

export const vessels = pgTable(
  'vessels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mmsi: varchar('mmsi', { length: 9 }).notNull(),
    imo: varchar('imo', { length: 16 }),
    name: varchar('name', { length: 255 }),
    callSign: varchar('call_sign', { length: 32 }),
    shipType: smallint('ship_type'),
    destination: varchar('destination', { length: 120 }),
    dimensionToBow: smallint('dimension_to_bow'),
    dimensionToStern: smallint('dimension_to_stern'),
    dimensionToPort: smallint('dimension_to_port'),
    dimensionToStarboard: smallint('dimension_to_starboard'),
    sanctionsStatus: varchar('sanctions_status', { length: 16 }),
    sanctionsCheckedAt: timestamp('sanctions_checked_at', { withTimezone: true }),
    sanctionsMatches: jsonb('sanctions_matches').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vessels_mmsi_unique').on(t.mmsi),
    index('vessels_imo_idx').on(t.imo),
    index('vessels_sanctions_status_idx').on(t.sanctionsStatus),
  ],
);

export const vesselPositionsLatest = pgTable(
  'vessel_positions_latest',
  {
    vesselId: uuid('vessel_id')
      .primaryKey()
      .references(() => vessels.id, { onDelete: 'cascade' }),
    mmsi: varchar('mmsi', { length: 9 }).notNull(),
    position: geometry('position', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    sog: doublePrecision('sog'),
    cog: doublePrecision('cog'),
    trueHeading: smallint('true_heading'),
    navStatus: smallint('nav_status'),
    rateOfTurn: doublePrecision('rate_of_turn'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vessel_positions_latest_position_gist').using('gist', t.position),
    index('vessel_positions_latest_last_seen_idx').on(t.lastSeenAt),
    index('vessel_positions_latest_mmsi_idx').on(t.mmsi),
  ],
);

export type Vessel = typeof vessels.$inferSelect;
export type NewVessel = typeof vessels.$inferInsert;
export type VesselPositionLatest = typeof vesselPositionsLatest.$inferSelect;

/**
 * Logical parent table for append-only position history. The actual table is
 * partitioned by `occurred_at`, and daily child partitions are managed by raw
 * SQL migrations plus HistoryPartitionMaintenanceService.
 */
export const vesselPositionsHistory = pgTable(
  'vessel_positions_history',
  {
    vesselId: uuid('vessel_id').notNull(),
    mmsi: varchar('mmsi', { length: 9 }).notNull(),
    position: geometry('position', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    sog: doublePrecision('sog'),
    cog: doublePrecision('cog'),
    trueHeading: smallint('true_heading'),
    navStatus: smallint('nav_status'),
    rateOfTurn: doublePrecision('rate_of_turn'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('vessel_positions_history_vessel_occurred_uniq').on(t.vesselId, t.occurredAt),
  ],
);

export type VesselPositionHistory = typeof vesselPositionsHistory.$inferSelect;

export const sanctionedEntities = pgTable(
  'sanctioned_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: varchar('source', { length: 32 }).notNull(),
    sourceEntityId: varchar('source_entity_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 512 }).notNull(),
    imo: varchar('imo', { length: 16 }),
    mmsi: varchar('mmsi', { length: 9 }),
    aliases: text('aliases').array().notNull().default([]),
    flag: varchar('flag', { length: 128 }),
    listingDate: date('listing_date'),
    programs: text('programs').array().notNull().default([]),
    rawPayload: jsonb('raw_payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sanctioned_entities_source_entity_uniq').on(t.source, t.sourceEntityId),
    index('sanctioned_entities_imo_idx').on(t.imo),
    index('sanctioned_entities_mmsi_idx').on(t.mmsi),
    index('sanctioned_entities_name_idx').on(t.name),
    index('sanctioned_entities_aliases_gin').using('gin', t.aliases),
  ],
);

export const sanctionsImportRuns = pgTable(
  'sanctions_import_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: varchar('source', { length: 32 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: varchar('status', { length: 16 }).notNull(),
    recordsImported: integer('records_imported').notNull().default(0),
    errors: jsonb('errors').notNull().default([]),
  },
  (t) => [index('sanctions_import_runs_source_started_idx').on(t.source, t.startedAt)],
);

export type SanctionedEntity = typeof sanctionedEntities.$inferSelect;
export type NewSanctionedEntity = typeof sanctionedEntities.$inferInsert;
export type SanctionsImportRun = typeof sanctionsImportRuns.$inferSelect;

export const geoDatasetVersions = pgTable(
  'geo_dataset_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: text('version').notNull(),
    sourceMetadata: jsonb('source_metadata').notNull(),
    coverageMarginKm: doublePrecision('coverage_margin_km').notNull(),
    coastalToleranceMeters: doublePrecision('coastal_tolerance_meters').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('geo_dataset_versions_version_uniq').on(t.version),
    uniqueIndex('geo_dataset_versions_single_active_idx')
      .on(t.isActive)
      .where(sql`${t.isActive}`),
  ],
);

export const geoLandPolygons = pgTable(
  'geo_land_polygons',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    datasetVersionId: uuid('dataset_version_id')
      .notNull()
      .references(() => geoDatasetVersions.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceLayer: text('source_layer'),
    region: text('region'),
    geom: geoGeometry('geom').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('geo_land_polygons_dataset_version_idx').on(t.datasetVersionId),
    index('geo_land_polygons_source_idx').on(t.source),
    index('geo_land_polygons_geom_gist').using('gist', t.geom),
  ],
);

export const geoNavigableWaterPolygons = pgTable(
  'geo_navigable_water_polygons',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    datasetVersionId: uuid('dataset_version_id')
      .notNull()
      .references(() => geoDatasetVersions.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceLayer: text('source_layer'),
    region: text('region'),
    geom: geoGeometry('geom').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('geo_navigable_water_polygons_dataset_version_idx').on(t.datasetVersionId),
    index('geo_navigable_water_polygons_source_idx').on(t.source),
    index('geo_navigable_water_polygons_geom_gist').using('gist', t.geom),
  ],
);

export const geoManualOverrides = pgTable(
  'geo_manual_overrides',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    datasetVersionId: uuid('dataset_version_id')
      .notNull()
      .references(() => geoDatasetVersions.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceLayer: text('source_layer'),
    region: text('region'),
    geom: geoGeometry('geom').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('geo_manual_overrides_dataset_version_idx').on(t.datasetVersionId),
    index('geo_manual_overrides_source_idx').on(t.source),
    index('geo_manual_overrides_geom_gist').using('gist', t.geom),
  ],
);

export type GeoDatasetVersion = typeof geoDatasetVersions.$inferSelect;
