import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

const Mmsi = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((s) => /^\d{9}$/.test(s), { message: 'mmsi must be a 9-digit string' });

export const PositionEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal('position'),
  mmsi: Mmsi,
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  sog: z.number().nonnegative().nullable().optional(),
  cog: z.number().gte(0).lte(360).nullable().optional(),
  trueHeading: z.number().int().gte(0).lte(511).nullable().optional(),
  navStatus: z.number().int().gte(0).lte(15).nullable().optional(),
  rateOfTurn: z.number().nullable().optional(),
  shipName: z.string().max(255).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  provider: z.string().min(1),
  ingestedAt: z.string().datetime({ offset: true }),
  traceId: z.string().uuid().optional(),
});
export type PositionEvent = z.infer<typeof PositionEventSchema>;

export const StaticEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal('static'),
  mmsi: Mmsi,
  imo: z.string().regex(/^\d{7}$/).nullable().optional(),
  name: z.string().max(255).nullable().optional(),
  callSign: z.string().max(32).nullable().optional(),
  shipType: z.number().int().gte(0).lte(255).nullable().optional(),
  dimensionToBow: z.number().int().nonnegative().nullable().optional(),
  dimensionToStern: z.number().int().nonnegative().nullable().optional(),
  dimensionToPort: z.number().int().nonnegative().nullable().optional(),
  dimensionToStarboard: z.number().int().nonnegative().nullable().optional(),
  destination: z.string().max(120).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  provider: z.string().min(1),
  ingestedAt: z.string().datetime({ offset: true }),
  traceId: z.string().uuid().optional(),
});
export type StaticEvent = z.infer<typeof StaticEventSchema>;

export const CanonicalEventSchema = z.discriminatedUnion('kind', [
  PositionEventSchema,
  StaticEventSchema,
]);
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

/** Raw provider message envelope handed from connector → filter → normalizer. */
export interface RawProviderMessage<T = unknown> {
  provider: string;
  receivedAt: string;
  payload: T;
}

export const SanctionMatchSchema = z.object({
  entityId: z.string(),
  source: z.string(),
  sourceEntityId: z.string(),
  name: z.string(),
  matchMethod: z.enum(['imo', 'mmsi', 'name_candidate']),
  aliases: z.array(z.string()),
  flag: z.string().nullable(),
  listingDate: z.string().nullable(),
});

export const VesselEnrichedEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  vesselId: z.string().uuid(),
  mmsi: z.string().regex(/^\d{9}$/),
  status: z.enum(['clear', 'candidate', 'sanctioned']),
  matches: z.array(SanctionMatchSchema),
  checkedAt: z.string().datetime({ offset: true }),
  traceId: z.string().uuid().optional(),
});
export type VesselEnrichedEvent = z.infer<typeof VesselEnrichedEventSchema>;
