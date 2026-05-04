/**
 * Pulls the standard correlation fields out of a canonical-event-shaped
 * payload. Returns only the fields that are present so log lines stay
 * readable. Used by the bus dispatch and by per-consumer log lines so a
 * single event can be traced through the pipeline via grep on traceId.
 */
export interface CorrelationFields {
  traceId?: string;
  mmsi?: string;
  vesselId?: string;
  streamMessageId?: string;
  consumerGroup?: string;
  provider?: string;
  stream?: string;
}

export function correlationFromPayload(payload: unknown): CorrelationFields {
  const out: CorrelationFields = {};
  if (typeof payload !== 'object' || payload === null) return out;
  const p = payload as Record<string, unknown>;
  if (typeof p.traceId === 'string') out.traceId = p.traceId;
  if (typeof p.mmsi === 'string') out.mmsi = p.mmsi;
  else if (typeof p.mmsi === 'number' && Number.isFinite(p.mmsi)) out.mmsi = String(p.mmsi);
  if (typeof p.vesselId === 'string') out.vesselId = p.vesselId;
  if (typeof p.provider === 'string') out.provider = p.provider;
  return out;
}
