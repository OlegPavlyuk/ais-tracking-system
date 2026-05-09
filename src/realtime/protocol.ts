import { z } from 'zod';
import { PositionEvent, StaticEvent, VesselEnrichedEvent } from '../contracts';

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe') }).strict(),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'position'; data: PositionEvent }
  | { type: 'static'; data: StaticEvent }
  | { type: 'vessel.enriched'; data: VesselEnrichedEvent }
  | { type: 'error'; error: { code: string; message: string; details?: unknown } };
