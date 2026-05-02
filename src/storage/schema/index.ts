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
} from 'drizzle-orm/pg-core';

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
