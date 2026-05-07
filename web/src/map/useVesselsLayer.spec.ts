import { describe, it, expect } from 'vitest';
import { buildFeatureCollection } from './buildFeatureCollection';
import type { Vessel } from '@/store/types';

function makeVessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    mmsi: '123456789',
    vesselId: null,
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

  it('falls back to trueHeading when cog is null', () => {
    const vessels = new Map([
      ['a', makeVessel({ cog: null, trueHeading: 180 })],
    ]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(180);
  });

  it('uses 0 rotation when both cog and trueHeading are null', () => {
    const vessels = new Map([['a', makeVessel({ cog: null, trueHeading: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(0);
  });

  it('sets correct coordinates', () => {
    const vessels = new Map([['a', makeVessel({ lon: 33.5, lat: 44.2 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.geometry.coordinates).toEqual([33.5, 44.2]);
  });
});
