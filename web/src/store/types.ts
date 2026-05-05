import type { PositionEvent, StaticEvent, VesselEnrichedEvent } from '@contracts';

export interface VesselSanctionMatch {
  id: string;
  source: 'ofac' | 'opensanctions';
  entityName: string;
  matchMethod: string;
  score: number | null;
}

export interface Vessel {
  mmsi: string;
  vesselId: string | null;

  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  trueHeading: number | null;
  navStatus: number | null;
  occurredAt: string | null;

  imo: string | null;
  name: string | null;
  callSign: string | null;
  shipType: number | null;
  destination: string | null;
  staticOccurredAt: string | null;

  sanctionsStatus: 'clear' | 'candidate' | 'sanctioned' | null;
  sanctionsCheckedAt: string | null;
  sanctionsMatches: VesselSanctionMatch[] | null;
}

export interface SnapshotRow {
  id: string;
  mmsi: string;
  imo: string | null;
  name: string | null;
  callSign: string | null;
  shipType: number | null;
  lon: number;
  lat: number;
  sog: number | null;
  cog: number | null;
  trueHeading: number | null;
  navStatus: number | null;
  occurredAt: string;
  lastSeenAt: string;
}

export type { PositionEvent, StaticEvent, VesselEnrichedEvent };

export interface VesselDetailRow {
  id: string;
  mmsi: string;
  imo: string | null;
  name: string | null;
  callSign: string | null;
  shipType: number | null;
  destination: string | null;
  dimensionToBow: number | null;
  dimensionToStern: number | null;
  dimensionToPort: number | null;
  dimensionToStarboard: number | null;
  sanctionsStatus: 'clear' | 'candidate' | 'sanctioned' | null;
  sanctionsCheckedAt: string | null;
  sanctionsMatches: VesselSanctionMatch[];
  position: {
    lat: number;
    lon: number;
    sog: number | null;
    cog: number | null;
    trueHeading: number | null;
    navStatus: number | null;
    occurredAt: string;
  } | null;
}
