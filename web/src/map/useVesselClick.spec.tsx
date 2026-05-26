import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapLayerMouseEvent, Map as MlMap } from 'maplibre-gl';
import { useVesselClick } from './useVesselClick';
import { MapViewIds } from './mapViewIds';
import { useVesselsStore } from '@/store/vessels';
import type { Vessel } from '@/store/types';

type ClickHandler = (event: MapLayerMouseEvent) => void;

function makeVessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    mmsi: '123456789',
    vesselId: 'vessel-from-store',
    lastSeenAt: null,
    lat: 43,
    lon: 30,
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
  readonly clickHandlers = new Map<string, ClickHandler>();
  readonly canvas = document.createElement('canvas');

  on(event: string, layerOrHandler: string | ClickHandler, handler?: ClickHandler): this {
    if (event === 'click' && typeof layerOrHandler === 'string' && handler) {
      this.clickHandlers.set(layerOrHandler, handler);
    }
    return this;
  }

  off(event: string, layerOrHandler: string | ClickHandler): this {
    if (event === 'click' && typeof layerOrHandler === 'string') {
      this.clickHandlers.delete(layerOrHandler);
    }
    return this;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
}

function HookHarness({ map, onSelect }: { map: MlMap; onSelect: Parameters<typeof useVesselClick>[1] }) {
  useVesselClick(map, onSelect);
  return null;
}

function clickEvent(properties: Record<string, unknown>): MapLayerMouseEvent {
  return {
    features: [
      {
        properties,
        geometry: { coordinates: [30, 43] },
      },
    ],
    lngLat: { lng: 30, lat: 43 },
  } as unknown as MapLayerMouseEvent;
}

beforeEach(() => {
  useVesselsStore.setState({
    vessels: new Map([['123456789', makeVessel()]]),
    wsStatus: 'idle',
    error: null,
  });
});

afterEach(() => {
  cleanup();
  useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
});

describe('useVesselClick', () => {
  it('resolves vesselId from the store using minimal feature properties', () => {
    const map = new FakeMap();
    const onSelect = vi.fn();
    render(<HookHarness map={map as unknown as MlMap} onSelect={onSelect} />);

    map.clickHandlers.get(MapViewIds.vesselsLayerId)?.(clickEvent({ mmsi: '123456789' }));

    expect(onSelect).toHaveBeenCalledWith({
      mmsi: '123456789',
      vesselId: 'vessel-from-store',
      anchorLngLat: [30, 43],
    });
  });

  it('falls back to null vesselId when the clicked vessel is missing from the store', () => {
    useVesselsStore.setState({ vessels: new Map() });
    const map = new FakeMap();
    const onSelect = vi.fn();
    render(<HookHarness map={map as unknown as MlMap} onSelect={onSelect} />);

    map.clickHandlers.get(MapViewIds.vesselsLayerId)?.(clickEvent({ mmsi: '123456789' }));

    expect(onSelect).toHaveBeenCalledWith({
      mmsi: '123456789',
      vesselId: null,
      anchorLngLat: [30, 43],
    });
  });
});
