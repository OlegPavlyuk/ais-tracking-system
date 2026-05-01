import { z } from 'zod';
import { PositionEvent, StaticEvent } from '../contracts';
import { Bbox } from '../shared/config/constants';

const BboxSchema = z
  .object({
    minLon: z.number().gte(-180).lte(180),
    minLat: z.number().gte(-90).lte(90),
    maxLon: z.number().gte(-180).lte(180),
    maxLat: z.number().gte(-90).lte(90),
  })
  .superRefine((b, ctx) => {
    if (!(b.minLon < b.maxLon)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minLon must be less than maxLon' });
    }
    if (!(b.minLat < b.maxLat)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minLat must be less than maxLat' });
    }
  });

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), bbox: BboxSchema }),
  z.object({ type: z.literal('update_subscription'), bbox: BboxSchema }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'position'; data: PositionEvent }
  | { type: 'static'; data: StaticEvent }
  | { type: 'vessel.enriched'; data: unknown }
  | { type: 'error'; error: { code: string; message: string; details?: unknown } };

export function bboxFromMessage(msg: ClientMessage): Bbox {
  return msg.bbox;
}
