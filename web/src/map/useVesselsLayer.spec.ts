import { describe, it, expect } from 'vitest';
import { buildFeatureCollection } from './buildFeatureCollection';
import type { Vessel } from '@/store/types';

function makeVessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    mmsi: '123456789',
    vesselId: null,
    lastSeenAt: null,
    lat: 43.0,
    lon: 33.0,
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
    ...overrides,
  };
}

describe('buildFeatureCollection', () => {
  it('skips vessels without coordinates', () => {
    const vessels = new Map([['a', makeVessel({ lat: null, lon: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features).toHaveLength(0);
  });

  it('includes mmsi, rotation, shipType, and color in feature properties', () => {
    const vessels = new Map([
      ['a', makeVessel({ mmsi: '123456789', cog: 90, shipType: 70 })],
    ]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features).toHaveLength(1);
    const props = fc.features[0]!.properties;
    expect(props.mmsi).toBe('123456789');
    expect(props.rotation).toBe(90);
    expect(props.shipType).toBe(70);
    expect(props.color).toBe('#2ECC71'); // Cargo
  });

  it('uses Unknown/Other color when shipType is null', () => {
    const vessels = new Map([['a', makeVessel({ shipType: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.color).toBe('#95A5A6');
  });

  it('prefers valid COG over trueHeading for rotation', () => {
    const vessels = new Map([
      ['a', makeVessel({ cog: 90, trueHeading: 180 })],
    ]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(90);
  });

  it('falls back to trueHeading when cog is null', () => {
    const vessels = new Map([
      ['a', makeVessel({ cog: null, trueHeading: 180 })],
    ]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(180);
  });

  it('treats trueHeading 511 as unavailable and falls back to cog', () => {
    const vessels = new Map([
      ['a', makeVessel({ cog: 90, trueHeading: 511 })],
    ]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(90);
  });

  it('treats out-of-range COG as unavailable and falls back to trueHeading', () => {
    const vessels = new Map([
      ['a', makeVessel({ cog: 360, trueHeading: 270 })],
    ]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(270);
  });

  it('uses 0 rotation when both cog and trueHeading are null', () => {
    const vessels = new Map([['a', makeVessel({ cog: null, trueHeading: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(0);
  });

  it('uses 0 rotation when both cog and trueHeading are out of range', () => {
    const vessels = new Map([['a', makeVessel({ cog: 360, trueHeading: 511 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(0);
  });

  it('sets correct coordinates', () => {
    const vessels = new Map([['a', makeVessel({ lon: 33.5, lat: 44.2 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.geometry.coordinates).toEqual([33.5, 44.2]);
  });

  it('includes readable navStatusLabel in properties', () => {
    const vessels = new Map([['a', makeVessel({ navStatus: 0 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.navStatusLabel).toBe('Under way (engine)');
  });

  it('navStatusLabel is — when navStatus is null', () => {
    const vessels = new Map([['a', makeVessel({ navStatus: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.navStatusLabel).toBe('—');
  });

  it('sets markerShape to circle for At anchor (1)', () => {
    const vessels = new Map([['a', makeVessel({ navStatus: 1 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.markerShape).toBe('circle');
  });

  it('sets markerShape to circle for Moored (5)', () => {
    const vessels = new Map([['a', makeVessel({ navStatus: 5 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.markerShape).toBe('circle');
  });

  it('sets markerShape to circle for Aground (6)', () => {
    const vessels = new Map([['a', makeVessel({ navStatus: 6 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.markerShape).toBe('circle');
  });

  it('sets markerShape to arrow for underway vessels', () => {
    const vessels = new Map([['a', makeVessel({ navStatus: 0, sog: 10 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.markerShape).toBe('arrow');
  });

  it('sets markerShape to circle via SOG fallback when navStatus is null and SOG ≤ 0.3', () => {
    const vessels = new Map([['a', makeVessel({ navStatus: null, sog: 0.1 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.markerShape).toBe('circle');
  });

  it('includes occurredAt in feature properties', () => {
    const ts = '2025-06-01T10:00:00.000Z';
    const vessels = new Map([['a', makeVessel({ occurredAt: ts })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.occurredAt).toBe(ts);
  });

  it('occurredAt is null when not set', () => {
    const vessels = new Map([['a', makeVessel({ occurredAt: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.occurredAt).toBeNull();
  });

  it('includes vesselName in feature properties', () => {
    const vessels = new Map([['a', makeVessel({ name: 'EVER GIVEN' })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.vesselName).toBe('EVER GIVEN');
  });

  it('vesselName is null when name is not set', () => {
    const vessels = new Map([['a', makeVessel({ name: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.vesselName).toBeNull();
  });
});
