/**
 * Black Sea bbox — single source of truth for both the AISStream subscription
 * and the public `BBOX_OUT_OF_SCOPE` boundary check. Coordinates match the
 * captured fixture in `aisstream/raw-api-response.jsonl`.
 */
export const BLACK_SEA_BBOX = {
  minLon: 27.0,
  minLat: 40.5,
  maxLon: 42.5,
  maxLat: 47.5,
} as const;

export type Bbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon &&
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat
  );
}

export const AIS_EVENTS_STREAM = 'ais.events.v1';
export const VESSEL_ENRICHED_STREAM = 'vessel.enriched';
export const AIS_DEADLETTER_STREAM = 'ais.deadletter';

/** Streams introspected by `GET /admin/streams`. Update when adding new streams. */
export const KNOWN_STREAMS: readonly string[] = [
  AIS_EVENTS_STREAM,
  VESSEL_ENRICHED_STREAM,
  AIS_DEADLETTER_STREAM,
] as const;
