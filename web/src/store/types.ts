import type { PositionEvent, StaticEvent, VesselEnrichedEvent } from '@contracts';

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
