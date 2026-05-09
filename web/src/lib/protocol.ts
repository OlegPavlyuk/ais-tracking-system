import { z } from 'zod';
import {
  PositionEventSchema,
  StaticEventSchema,
  VesselEnrichedEventSchema,
} from '@contracts';

export const ServerErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const ServerPositionSchema = z.object({
  type: z.literal('position'),
  data: PositionEventSchema,
});

export const ServerStaticSchema = z.object({
  type: z.literal('static'),
  data: StaticEventSchema,
});

export const ServerVesselEnrichedSchema = z.object({
  type: z.literal('vessel.enriched'),
  data: VesselEnrichedEventSchema,
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  ServerPositionSchema,
  ServerStaticSchema,
  ServerVesselEnrichedSchema,
  ServerErrorSchema,
]);

export type ServerMessageParsed = z.infer<typeof ServerMessageSchema>;

export type ClientMessage = { type: 'subscribe' };
