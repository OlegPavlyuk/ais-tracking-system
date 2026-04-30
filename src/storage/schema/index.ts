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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vessels_mmsi_unique').on(t.mmsi),
    index('vessels_imo_idx').on(t.imo),
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
