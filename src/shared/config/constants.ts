export type Bbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export type AisStreamBoundingBox = readonly [
  readonly [minLat: number, minLon: number],
  readonly [maxLat: number, maxLon: number],
];

/**
 * Coverage boxes used by provider-side filtering and server-side guards.
 * Coordinates match bboxfinder's minLon,minLat,maxLon,maxLat format.
 */
export const BLACK_SEA_BBOX = {
  minLon: 27.0,
  minLat: 40.5,
  maxLon: 42.5,
  maxLat: 47.5,
} as const satisfies Bbox;

export const LEVANT_EAST_MEDITERRANEAN_BBOX = {
  minLon: 34.782715,
  minLat: 32.787275,
  maxLon: 36.254883,
  maxLat: 36.967449,
} as const satisfies Bbox;

export const CENTRAL_EAST_MEDITERRANEAN_BBOX = {
  minLon: 9.492188,
  minLat: 30.477083,
  maxLon: 35.084839,
  maxLat: 46.437857,
} as const satisfies Bbox;

export const WEST_MEDITERRANEAN_EUROPE_BBOX = {
  minLon: -6.152344,
  minLat: 34.452218,
  maxLon: 9.09668,
  maxLat: 48.57479,
} as const satisfies Bbox;

export const AIS_COVERAGE_ZONES = [
  { name: 'Black Sea', bbox: BLACK_SEA_BBOX },
  { name: 'Levant / East Mediterranean', bbox: LEVANT_EAST_MEDITERRANEAN_BBOX },
  { name: 'Central / East Mediterranean', bbox: CENTRAL_EAST_MEDITERRANEAN_BBOX },
  { name: 'West Mediterranean / Europe', bbox: WEST_MEDITERRANEAN_EUROPE_BBOX },
] as const satisfies readonly { name: string; bbox: Bbox }[];

export const AIS_COVERAGE_BBOXES = AIS_COVERAGE_ZONES.map((zone) => zone.bbox) as readonly Bbox[];

export function pointInBbox(lat: number, lon: number, bbox: Bbox): boolean {
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
}

export function pointInAnyBbox(lat: number, lon: number, bboxes: readonly Bbox[]): boolean {
  return bboxes.some((bbox) => pointInBbox(lat, lon, bbox));
}

export function toAisStreamBoundingBox(bbox: Bbox): AisStreamBoundingBox {
  return [
    [bbox.minLat, bbox.minLon],
    [bbox.maxLat, bbox.maxLon],
  ];
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
