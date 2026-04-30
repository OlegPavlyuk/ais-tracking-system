import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

const Mmsi = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((s) => /^\d{9}$/.test(s), { message: 'mmsi must be a 9-digit string' });

const PositionEventBase = z.object({
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
  shipName: z.string().nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  provider: z.string().min(1),
  ingestedAt: z.string().datetime({ offset: true }),
});

export const PositionEventSchema = PositionEventBase;
export type PositionEvent = z.infer<typeof PositionEventSchema>;

export const CanonicalEventSchema = PositionEventSchema; // discriminated union grows in slice #3
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

/** Raw provider message envelope handed from connector → filter → normalizer. */
export interface RawProviderMessage<T = unknown> {
  provider: string;
  receivedAt: string;
  payload: T;
}
