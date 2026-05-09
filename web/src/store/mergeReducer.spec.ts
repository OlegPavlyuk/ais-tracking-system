import { describe, expect, it } from 'vitest';
import {
  applyEnriched,
  applyPosition,
  applySnapshotRows,
  applyStatic,
  emptyVessel,
} from './mergeReducer';
import type { PositionEvent, SnapshotRow, StaticEvent, Vessel, VesselEnrichedEvent } from './types';

const MMSI_A = '111111111';
const MMSI_B = '222222222';

function snapshotRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: 'vessel-a',
    mmsi: MMSI_A,
    imo: '1234567',
    name: 'ALPHA',
    callSign: 'CALL',
    shipType: 70,
    lon: 30,
    lat: 43,
    sog: 10,
    cog: 90,
    trueHeading: 91,
    navStatus: 0,
    occurredAt: '2024-01-01T00:00:00.000Z',
    lastSeenAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function positionEvent(overrides: Partial<PositionEvent> = {}): PositionEvent {
  return {
    schemaVersion: 1,
    kind: 'position',
    mmsi: MMSI_A,
    lat: 44,
    lon: 31,
    sog: 12,
    cog: 100,
    trueHeading: 101,
    navStatus: 1,
    occurredAt: '2024-01-01T00:01:00.000Z',
    provider: 'test',
    ingestedAt: '2024-01-01T00:01:00.000Z',
    ...overrides,
  } as PositionEvent;
}

function staticEvent(overrides: Partial<StaticEvent> = {}): StaticEvent {
  return {
    schemaVersion: 1,
    kind: 'static',
    mmsi: MMSI_A,
    imo: '7654321',
    name: 'BRAVO',
    callSign: 'CALL2',
    shipType: 80,
    destination: 'IST',
    occurredAt: '2024-01-01T00:00:30.000Z',
    provider: 'test',
    ingestedAt: '2024-01-01T00:00:30.000Z',
    ...overrides,
  } as StaticEvent;
}

describe('applyPosition', () => {
  it('upserts a stub when mmsi is unknown', () => {
    const next = applyPosition(new Map(), positionEvent());
    const v = next.get(MMSI_A) as Vessel;
    expect(v.lat).toBe(44);
    expect(v.lon).toBe(31);
    expect(v.occurredAt).toBe('2024-01-01T00:01:00.000Z');
  });

  it('ignores older events (timestamp guard)', () => {
    const seeded = new Map<string, Vessel>([
      [MMSI_A, { ...emptyVessel(MMSI_A), occurredAt: '2024-01-01T00:05:00.000Z', lat: 1, lon: 2 }],
    ]);
    const next = applyPosition(seeded, positionEvent({ occurredAt: '2024-01-01T00:01:00.000Z' }));
    const v = next.get(MMSI_A) as Vessel;
    expect(v.lat).toBe(1);
    expect(v.lon).toBe(2);
    expect(next).toBe(seeded);
  });

  it('preserves existing name when event omits shipName', () => {
    const seeded = new Map<string, Vessel>([
      [MMSI_A, { ...emptyVessel(MMSI_A), name: 'KEPT' }],
    ]);
    const next = applyPosition(seeded, positionEvent({ shipName: null }));
    expect((next.get(MMSI_A) as Vessel).name).toBe('KEPT');
  });
});

describe('applyStatic', () => {
  it('creates a stub when mmsi is unknown', () => {
    const next = applyStatic(new Map(), staticEvent());
    const v = next.get(MMSI_A) as Vessel;
    expect(v.name).toBe('BRAVO');
    expect(v.imo).toBe('7654321');
    expect(v.staticOccurredAt).toBe('2024-01-01T00:00:30.000Z');
    expect(v.lat).toBeNull();
  });

  it('does not overwrite a non-null profile field with null', () => {
    const seeded = new Map<string, Vessel>([
      [MMSI_A, { ...emptyVessel(MMSI_A), name: 'KEPT', staticOccurredAt: '2024-01-01T00:00:00.000Z' }],
    ]);
    const next = applyStatic(seeded, staticEvent({ name: null }));
    expect((next.get(MMSI_A) as Vessel).name).toBe('KEPT');
  });

  it('rejects older static events (timestamp guard)', () => {
    const seeded = new Map<string, Vessel>([
      [
        MMSI_A,
        {
          ...emptyVessel(MMSI_A),
          name: 'NEWER',
          staticOccurredAt: '2024-01-01T01:00:00.000Z',
        },
      ],
    ]);
    const next = applyStatic(seeded, staticEvent({ name: 'OLDER' }));
    expect((next.get(MMSI_A) as Vessel).name).toBe('NEWER');
  });
});

describe('applySnapshotRows', () => {
  it('preserves vessels not present in a limited snapshot', () => {
    const seeded = new Map<string, Vessel>([
      [MMSI_A, emptyVessel(MMSI_A)],
      [MMSI_B, emptyVessel(MMSI_B)],
    ]);
    const next = applySnapshotRows(seeded, [snapshotRow()]);
    expect(next.has(MMSI_A)).toBe(true);
    expect(next.has(MMSI_B)).toBe(true);
  });

  it('does not overwrite WS-derived position when WS occurredAt is newer than snapshot occurredAt', () => {
    const seeded = new Map<string, Vessel>([
      [
        MMSI_A,
        {
          ...emptyVessel(MMSI_A),
          lat: 50,
          lon: 35,
          occurredAt: '2024-01-01T00:10:00.000Z',
        },
      ],
    ]);
    const next = applySnapshotRows(seeded, [
      snapshotRow({
        lat: 43,
        lon: 30,
        occurredAt: '2024-01-01T00:05:00.000Z',
        lastSeenAt: '2024-01-01T00:05:00.000Z',
      }),
    ]);
    const v = next.get(MMSI_A) as Vessel;
    expect(v.lat).toBe(50);
    expect(v.lon).toBe(35);
    expect(v.occurredAt).toBe('2024-01-01T00:10:00.000Z');
    // Profile fields and vesselId still merge in.
    expect(v.vesselId).toBe('vessel-a');
    expect(v.name).toBe('ALPHA');
  });

  it('updates lastSeenAt from snapshot rows for explicit aging decisions', () => {
    const next = applySnapshotRows(new Map(), [
      snapshotRow({ lastSeenAt: '2024-01-01T00:20:00.000Z' }),
    ]);
    expect((next.get(MMSI_A) as Vessel).lastSeenAt).toBe('2024-01-01T00:20:00.000Z');
  });

  it('uses AIS occurredAt (not DB lastSeenAt) for position freshness', () => {
    // Regression: lastSeenAt is a DB write time, so a recently re-written
    // stale AIS sample must NOT clobber a newer WS-derived position.
    const seeded = new Map<string, Vessel>([
      [
        MMSI_A,
        {
          ...emptyVessel(MMSI_A),
          lat: 50,
          lon: 35,
          occurredAt: '2024-01-01T00:10:00.000Z',
        },
      ],
    ]);
    const next = applySnapshotRows(seeded, [
      snapshotRow({
        lat: 43,
        lon: 30,
        occurredAt: '2024-01-01T00:05:00.000Z',
        lastSeenAt: '2024-01-01T00:20:00.000Z',
      }),
    ]);
    const v = next.get(MMSI_A) as Vessel;
    expect(v.lat).toBe(50);
    expect(v.lon).toBe(35);
    expect(v.occurredAt).toBe('2024-01-01T00:10:00.000Z');
  });

  it('overwrites position when snapshot occurredAt is newer or equal', () => {
    const seeded = new Map<string, Vessel>([
      [
        MMSI_A,
        {
          ...emptyVessel(MMSI_A),
          lat: 50,
          lon: 35,
          occurredAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    ]);
    const next = applySnapshotRows(seeded, [
      snapshotRow({
        lat: 43,
        lon: 30,
        occurredAt: '2024-01-01T00:05:00.000Z',
        lastSeenAt: '2024-01-01T00:05:00.000Z',
      }),
    ]);
    const v = next.get(MMSI_A) as Vessel;
    expect(v.lat).toBe(43);
    expect(v.lon).toBe(30);
  });

  it('populates position on first snapshot when vessel was previously unknown', () => {
    const next = applySnapshotRows(new Map(), [snapshotRow()]);
    const v = next.get(MMSI_A) as Vessel;
    expect(v.lat).toBe(43);
    expect(v.lon).toBe(30);
    expect(v.occurredAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('preserves stored profile fields when snapshot row provides null', () => {
    const seeded = new Map<string, Vessel>([
      [MMSI_A, { ...emptyVessel(MMSI_A), imo: 'KEPT_IMO', name: 'KEPT_NAME' }],
    ]);
    const next = applySnapshotRows(seeded, [snapshotRow({ imo: null, name: null })]);
    const v = next.get(MMSI_A) as Vessel;
    expect(v.imo).toBe('KEPT_IMO');
    expect(v.name).toBe('KEPT_NAME');
  });

  it('always sets vesselId from the snapshot row', () => {
    const next = applySnapshotRows(new Map(), [snapshotRow({ id: 'v-42' })]);
    expect((next.get(MMSI_A) as Vessel).vesselId).toBe('v-42');
  });
});

describe('pruneStaleVessels', () => {
  it('keeps vessels whose lastSeenAt is within the retention window', async () => {
    const { pruneStaleVessels, SNAPSHOT_RETENTION_MS } = await import('./mergeReducer');
    const now = Date.parse('2024-01-02T00:00:00.000Z');
    const seeded = new Map<string, Vessel>([
      [
        MMSI_A,
        { ...emptyVessel(MMSI_A), lastSeenAt: '2024-01-01T12:00:00.000Z' },
      ],
    ]);
    const next = pruneStaleVessels(seeded, now, SNAPSHOT_RETENTION_MS);
    expect(next.has(MMSI_A)).toBe(true);
  });

  it('removes vessels older than the explicit retention window', async () => {
    const { pruneStaleVessels, SNAPSHOT_RETENTION_MS } = await import('./mergeReducer');
    const now = Date.parse('2024-01-03T00:00:00.000Z');
    const seeded = new Map<string, Vessel>([
      [
        MMSI_A,
        { ...emptyVessel(MMSI_A), lastSeenAt: '2024-01-01T00:00:00.000Z' },
      ],
    ]);
    const next = pruneStaleVessels(seeded, now, SNAPSHOT_RETENTION_MS);
    expect(next.has(MMSI_A)).toBe(false);
  });
});

function enrichedEvent(overrides: Partial<VesselEnrichedEvent> = {}): VesselEnrichedEvent {
  return {
    schemaVersion: 1,
    vesselId: '00000000-0000-0000-0000-000000000001',
    mmsi: MMSI_A,
    status: 'clear',
    matches: [],
    checkedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as VesselEnrichedEvent;
}

describe('applyEnriched', () => {
  it('stores mapped sanctionsMatches from the event', () => {
    const next = applyEnriched(
      new Map(),
      enrichedEvent({
        status: 'sanctioned',
        matches: [
          {
            entityId: 'e-1',
            source: 'ofac',
            sourceEntityId: 'src-1',
            name: 'DANGER CORP',
            matchMethod: 'imo',
            aliases: [],
            flag: null,
            listingDate: null,
          },
        ],
      }),
    );
    const v = next.get(MMSI_A) as Vessel;
    expect(v.sanctionsStatus).toBe('sanctioned');
    expect(v.sanctionsMatches).toEqual([
      { id: 'e-1', source: 'ofac', entityName: 'DANGER CORP', matchMethod: 'imo', score: null },
    ]);
  });

  it('stores an empty array (not null) when event has no matches', () => {
    const next = applyEnriched(new Map(), enrichedEvent({ status: 'clear', matches: [] }));
    const v = next.get(MMSI_A) as Vessel;
    expect(v.sanctionsMatches).toEqual([]);
  });

  it('filters out matches with unsupported source values', () => {
    const next = applyEnriched(
      new Map(),
      enrichedEvent({
        matches: [
          {
            entityId: 'e-good',
            source: 'opensanctions',
            sourceEntityId: 'src-good',
            name: 'GOOD ENTITY',
            matchMethod: 'mmsi',
            aliases: [],
            flag: null,
            listingDate: null,
          },
          {
            entityId: 'e-bad',
            source: 'unknown_source',
            sourceEntityId: 'src-bad',
            name: 'BAD ENTITY',
            matchMethod: 'name_candidate',
            aliases: [],
            flag: null,
            listingDate: null,
          },
        ],
      }),
    );
    const v = next.get(MMSI_A) as Vessel;
    const matches = v.sanctionsMatches ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('e-good');
  });
});
