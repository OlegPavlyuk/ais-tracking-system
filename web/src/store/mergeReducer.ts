import type {
  VesselDetailRow,
  PositionEvent,
  SnapshotRow,
  StaticEvent,
  Vessel,
  VesselEnrichedEvent,
  VesselSanctionMatch,
} from './types';

export const SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function emptyVessel(mmsi: string): Vessel {
  return {
    mmsi,
    vesselId: null,
    lastSeenAt: null,
    lat: null,
    lon: null,
    sog: null,
    cog: null,
    trueHeading: null,
    navStatus: null,
    occurredAt: null,
    imo: null,
    name: null,
    callSign: null,
    shipType: null,
    destination: null,
    staticOccurredAt: null,
    sanctionsStatus: null,
    sanctionsCheckedAt: null,
    sanctionsMatches: null,
  };
}

function isNewer(incoming: string | null | undefined, current: string | null | undefined): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return Date.parse(incoming) >= Date.parse(current);
}

function preferNonNull<T>(incoming: T | null | undefined, current: T | null): T | null {
  if (incoming === null || incoming === undefined) return current;
  return incoming;
}

function maxTimestamp(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function vesselActivityAt(vessel: Vessel): string | null {
  return vessel.lastSeenAt ?? vessel.occurredAt ?? vessel.staticOccurredAt;
}

export function applySnapshotRows(
  prev: ReadonlyMap<string, Vessel>,
  rows: readonly SnapshotRow[],
): Map<string, Vessel> {
  const next = new Map(prev);
  for (const row of rows) {
    const existing = prev.get(row.mmsi);
    const base = existing ?? emptyVessel(row.mmsi);
    const merged: Vessel = { ...base };

    merged.vesselId = row.id;
    merged.lastSeenAt = maxTimestamp(base.lastSeenAt, row.lastSeenAt);

    // Compare AIS event times (occurredAt). lastSeenAt is a DB write timestamp
    // and would let a stale snapshot clobber a newer WS-derived position.
    if (isNewer(row.occurredAt, base.occurredAt)) {
      merged.lat = row.lat;
      merged.lon = row.lon;
      merged.sog = row.sog;
      merged.cog = row.cog;
      merged.trueHeading = row.trueHeading;
      merged.navStatus = row.navStatus;
      merged.occurredAt = row.occurredAt;
    }

    // Profile fields: merge without overwriting non-null with null.
    merged.imo = preferNonNull(row.imo, base.imo);
    merged.name = preferNonNull(row.name, base.name);
    merged.callSign = preferNonNull(row.callSign, base.callSign);
    merged.shipType = preferNonNull(row.shipType, base.shipType);
    if (isNewer(row.sanctionsCheckedAt, base.sanctionsCheckedAt)) {
      merged.sanctionsStatus = row.sanctionsStatus;
      merged.sanctionsCheckedAt = row.sanctionsCheckedAt;
    }

    next.set(row.mmsi, merged);
  }
  return next;
}

export function applyDetailSanctions(
  prev: ReadonlyMap<string, Vessel>,
  row: VesselDetailRow,
): Map<string, Vessel> {
  const base = prev.get(row.mmsi) ?? emptyVessel(row.mmsi);
  if (!isNewer(row.sanctionsCheckedAt, base.sanctionsCheckedAt)) {
    return prev as Map<string, Vessel>;
  }

  const next = new Map(prev);
  next.set(row.mmsi, {
    ...base,
    vesselId: row.id,
    sanctionsStatus: row.sanctionsStatus,
    sanctionsCheckedAt: row.sanctionsCheckedAt,
    sanctionsMatches: row.sanctionsMatches,
  });
  return next;
}

export function applyPosition(
  prev: ReadonlyMap<string, Vessel>,
  ev: PositionEvent,
): Map<string, Vessel> {
  const existing = prev.get(ev.mmsi);
  const base = existing ?? emptyVessel(ev.mmsi);
  if (!isNewer(ev.occurredAt, base.occurredAt)) {
    return prev as Map<string, Vessel>;
  }
  const next = new Map(prev);
  next.set(ev.mmsi, {
    ...base,
    lat: ev.lat,
    lon: ev.lon,
    sog: ev.sog ?? null,
    cog: ev.cog ?? null,
    trueHeading: ev.trueHeading ?? null,
    navStatus: ev.navStatus ?? null,
    occurredAt: ev.occurredAt,
    lastSeenAt: maxTimestamp(base.lastSeenAt, ev.ingestedAt),
    name: preferNonNull(ev.shipName, base.name),
  });
  return next;
}

export function applyStatic(
  prev: ReadonlyMap<string, Vessel>,
  ev: StaticEvent,
): Map<string, Vessel> {
  const base = prev.get(ev.mmsi) ?? emptyVessel(ev.mmsi);
  const next = new Map(prev);
  // Static events upsert profile fields by mmsi; create stub when unknown.
  // Timestamp guard applies to profile-occurred-at, not position-occurred-at.
  const accept = isNewer(ev.occurredAt, base.staticOccurredAt);
  next.set(ev.mmsi, {
    ...base,
    imo: accept ? preferNonNull(ev.imo, base.imo) : base.imo,
    name: accept ? preferNonNull(ev.name, base.name) : base.name,
    callSign: accept ? preferNonNull(ev.callSign, base.callSign) : base.callSign,
    shipType: accept ? preferNonNull(ev.shipType, base.shipType) : base.shipType,
    destination: accept ? preferNonNull(ev.destination, base.destination) : base.destination,
    staticOccurredAt: accept ? ev.occurredAt : base.staticOccurredAt,
  });
  return next;
}

export function applyEnriched(
  prev: ReadonlyMap<string, Vessel>,
  ev: VesselEnrichedEvent,
): Map<string, Vessel> {
  const base = prev.get(ev.mmsi) ?? emptyVessel(ev.mmsi);
  if (base.sanctionsCheckedAt && Date.parse(ev.checkedAt) < Date.parse(base.sanctionsCheckedAt)) {
    return prev as Map<string, Vessel>;
  }
  const matches: VesselSanctionMatch[] = ev.matches
    .filter((m) => m.source === 'ofac' || m.source === 'opensanctions')
    .map((m) => ({
      id: m.entityId,
      source: m.source as 'ofac' | 'opensanctions',
      entityName: m.name,
      matchMethod: m.matchMethod,
      score: null,
      programs: m.programs,
    }));

  const next = new Map(prev);
  next.set(ev.mmsi, {
    ...base,
    vesselId: ev.vesselId,
    sanctionsStatus: ev.status,
    sanctionsCheckedAt: ev.checkedAt,
    sanctionsMatches: matches,
  });
  return next;
}

export function pruneStaleVessels(
  prev: ReadonlyMap<string, Vessel>,
  now = Date.now(),
  maxAgeMs = SNAPSHOT_RETENTION_MS,
): Map<string, Vessel> {
  let changed = false;
  const next = new Map<string, Vessel>();
  for (const [mmsi, vessel] of prev) {
    const activityAt = vesselActivityAt(vessel);
    if (activityAt && now - Date.parse(activityAt) > maxAgeMs) {
      changed = true;
      continue;
    }
    next.set(mmsi, vessel);
  }
  return changed ? next : (prev as Map<string, Vessel>);
}
