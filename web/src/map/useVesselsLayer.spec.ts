import React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { buildFeatureCollection } from './buildFeatureCollection';
import { useVesselsLayer } from './useVesselsLayer';
import { useVesselsStore } from '@/store/vessels';
import { frontendMetrics } from '@/lib/frontendMetrics';
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

class FakeMap {
  readonly source = {
    setData: vi.fn(),
  };

  private readonly handlers = new Map<string, Set<() => void>>();

  getSource(): GeoJSONSource {
    return this.source as unknown as GeoJSONSource;
  }

  on(type: string, handler: () => void): this {
    const handlers = this.handlers.get(type) ?? new Set<() => void>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return this;
  }

  off(type: string, handler: () => void): this {
    this.handlers.get(type)?.delete(handler);
    return this;
  }

  emit(type: string): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler();
    }
  }
}

function HookHarness({ map }: { map: MlMap }) {
  useVesselsLayer(map);
  return null;
}

function advanceTimers(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function flushPendingTimers(): void {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  act(() => {
    vi.runOnlyPendingTimers();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0)),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => window.clearTimeout(id)),
  );
  frontendMetrics().reset();
  useVesselsStore.setState({
    vessels: new Map([['a', makeVessel()]]),
    wsStatus: 'idle',
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
  frontendMetrics().reset();
});

describe('useVesselsLayer', () => {
  it('flushes vessel source updates on the 500ms cadence', () => {
    const map = new FakeMap();
    render(React.createElement(HookHarness, { map: map as unknown as MlMap }));

    advanceTimers(499);
    expect(map.source.setData).not.toHaveBeenCalled();

    advanceTimers(1);
    flushPendingTimers();
    expect(map.source.setData).toHaveBeenCalledTimes(1);
  });

  it('records source update metrics when flushing vessel data', () => {
    const map = new FakeMap();
    render(React.createElement(HookHarness, { map: map as unknown as MlMap }));

    advanceTimers(500);
    flushPendingTimers();

    expect(frontendMetrics().vesselSourceUpdates.flushCount).toBe(1);
    expect(frontendMetrics().vesselSourceUpdates.lastVesselCount).toBe(1);
    expect(frontendMetrics().vesselSourceUpdates.lastFeatureCount).toBe(1);
    expect(frontendMetrics().vesselSourceUpdates.lastBuildDurationMs).toBeGreaterThanOrEqual(0);
    expect(frontendMetrics().vesselSourceUpdates.lastSetDataDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('defers source updates while the map is moving and flushes once after moveend', () => {
    const map = new FakeMap();
    render(React.createElement(HookHarness, { map: map as unknown as MlMap }));

    act(() => map.emit('movestart'));
    advanceTimers(1_000);
    expect(map.source.setData).not.toHaveBeenCalled();

    act(() => {
      useVesselsStore.setState((state) => ({
        vessels: new Map([...state.vessels, ['b', makeVessel({ mmsi: '987654321' })]]),
      }));
    });
    advanceTimers(1_000);
    expect(map.source.setData).not.toHaveBeenCalled();

    act(() => map.emit('moveend'));
    flushPendingTimers();
    expect(map.source.setData).toHaveBeenCalledTimes(1);
  });
});

describe('buildFeatureCollection', () => {
  it('skips vessels without coordinates', () => {
    const vessels = new Map([['a', makeVessel({ lat: null, lon: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features).toHaveLength(0);
  });

  it('includes only lightweight render properties in each feature', () => {
    const vessels = new Map([
      [
        'a',
        makeVessel({
          mmsi: '123456789',
          cog: 90,
          shipType: 70,
          sanctionsStatus: 'candidate',
        }),
      ],
    ]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features).toHaveLength(1);
    const props = fc.features[0]!.properties;
    expect(Object.keys(props).sort()).toEqual([
      'color',
      'markerShape',
      'mmsi',
      'rotation',
      'sanctionsStatus',
    ]);
    expect(props.mmsi).toBe('123456789');
    expect(props.rotation).toBe(90);
    expect(props.color).toBe('#2ECC71'); // Cargo
    expect(props.sanctionsStatus).toBe('candidate');
  });

  it('uses Unknown/Other color when shipType is null', () => {
    const vessels = new Map([['a', makeVessel({ shipType: null })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.color).toBe('#95A5A6');
  });

  it('prefers valid COG over trueHeading for rotation', () => {
    const vessels = new Map([['a', makeVessel({ cog: 90, trueHeading: 180 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(90);
  });

  it('falls back to trueHeading when cog is null', () => {
    const vessels = new Map([['a', makeVessel({ cog: null, trueHeading: 180 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(180);
  });

  it('treats trueHeading 511 as unavailable and falls back to cog', () => {
    const vessels = new Map([['a', makeVessel({ cog: 90, trueHeading: 511 })]]);
    const fc = buildFeatureCollection(vessels);
    expect(fc.features[0]!.properties.rotation).toBe(90);
  });

  it('treats out-of-range COG as unavailable and falls back to trueHeading', () => {
    const vessels = new Map([['a', makeVessel({ cog: 360, trueHeading: 270 })]]);
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
});
