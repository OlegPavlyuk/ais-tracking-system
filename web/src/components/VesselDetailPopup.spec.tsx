import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VesselDetailPopup } from './VesselDetailPopup';
import { useVesselsStore } from '@/store/vessels';
import type { Vessel } from '@/store/types';

interface PopupSpy {
  element: HTMLDivElement;
  setLngLat: ReturnType<typeof vi.fn>;
}

const popupState = vi.hoisted(() => ({
  instances: [] as PopupSpy[],
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Popup: class MockPopup {
      readonly element = document.createElement('div');
      readonly content = document.createElement('div');
      readonly setDOMContent = vi.fn((node: HTMLElement) => {
        this.content.replaceChildren(node);
        return this;
      });
      readonly setLngLat = vi.fn((_lngLat: unknown) => this);
      readonly addTo = vi.fn((_map: unknown) => {
        if (!this.element.isConnected) {
          document.body.appendChild(this.element);
        }
        return this;
      });
      readonly remove = vi.fn(() => {
        this.element.remove();
        return this;
      });

      constructor() {
        this.element.className = 'maplibregl-popup';
        this.content.className = 'maplibregl-popup-content';
        this.element.appendChild(this.content);
        popupState.instances.push(this);
      }

      getElement() {
        return this.element;
      }
    },
  },
}));

interface MockMap {
  clickHandlers: Array<(event: { point: { x: number; y: number } }) => void>;
  container: HTMLDivElement;
  on: (event: 'click', handler: (event: { point: { x: number; y: number } }) => void) => void;
  off: (event: 'click', handler: (event: { point: { x: number; y: number } }) => void) => void;
  queryRenderedFeatures: ReturnType<typeof vi.fn>;
  getContainer: () => HTMLDivElement;
}

function createMockMap(): MockMap {
  const clickHandlers: Array<(event: { point: { x: number; y: number } }) => void> = [];
  const container = document.createElement('div');
  document.body.appendChild(container);

  return {
    clickHandlers,
    container,
    on: (_event, handler) => {
      clickHandlers.push(handler);
    },
    off: (_event, handler) => {
      const idx = clickHandlers.indexOf(handler);
      if (idx >= 0) clickHandlers.splice(idx, 1);
    },
    queryRenderedFeatures: vi.fn(() => []),
    getContainer: () => container,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
}

function seedVessels(vessels: Vessel[]) {
  useVesselsStore.setState({
    vessels: new Map(vessels.map((vessel) => [vessel.mmsi, vessel])),
    wsStatus: 'idle',
    error: null,
  });
}

const VESSEL_ONE: Vessel = {
  mmsi: '111111111',
  vesselId: null,
  lastSeenAt: '2024-01-01T00:00:00.000Z',
  lat: 43.0,
  lon: 30.0,
  sog: 12.5,
  cog: 90,
  trueHeading: 91,
  navStatus: 0,
  occurredAt: '2024-01-01T00:00:00.000Z',
  imo: '1111111',
  name: 'VESSEL ONE',
  callSign: 'ONE',
  shipType: 70,
  destination: null,
  staticOccurredAt: null,
  sanctionsStatus: null,
  sanctionsCheckedAt: null,
  sanctionsMatches: null,
};

const VESSEL_TWO: Vessel = {
  ...VESSEL_ONE,
  mmsi: '222222222',
  name: 'VESSEL TWO',
  callSign: 'TWO',
  lat: 44.0,
  lon: 31.0,
};

function renderPopup(
  map: MockMap,
  selectedVessel: { mmsi: string; vesselId: string | null; anchorLngLat: [number, number] },
  onClose = vi.fn(),
) {
  return {
    onClose,
    ...render(
      <QueryClientProvider client={makeQueryClient()}>
        <VesselDetailPopup
          map={map as never}
          selectedVessel={selectedVessel}
          onClose={onClose}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  popupState.instances.length = 0;
  useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('VesselDetailPopup', () => {
  it('switches between vessels without recreating the popup instance', async () => {
    const map = createMockMap();
    seedVessels([VESSEL_ONE, VESSEL_TWO]);

    const { rerender } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <VesselDetailPopup
          map={map as never}
          selectedVessel={{ mmsi: VESSEL_ONE.mmsi, vesselId: null, anchorLngLat: [30, 43] }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('VESSEL ONE')).toBeInTheDocument();
    expect(popupState.instances).toHaveLength(1);

    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <VesselDetailPopup
          map={map as never}
          selectedVessel={{ mmsi: VESSEL_TWO.mmsi, vesselId: null, anchorLngLat: [31, 44] }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('VESSEL TWO')).toBeInTheDocument();
    expect(popupState.instances).toHaveLength(1);
  });

  it('closes on outside document click', async () => {
    const map = createMockMap();
    seedVessels([VESSEL_ONE]);
    const { onClose } = renderPopup(map, {
      mmsi: VESSEL_ONE.mmsi,
      vesselId: null,
      anchorLngLat: [30, 43],
    });

    const outside = document.createElement('button');
    document.body.appendChild(outside);

    fireEvent.pointerDown(outside);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('closes when clicking the map outside any vessel', async () => {
    const map = createMockMap();
    seedVessels([VESSEL_ONE]);
    const { onClose } = renderPopup(map, {
      mmsi: VESSEL_ONE.mmsi,
      vesselId: null,
      anchorLngLat: [30, 43],
    });

    act(() => {
      map.clickHandlers[0]?.({ point: { x: 10, y: 20 } });
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('does not close when clicking another vessel target area', async () => {
    const map = createMockMap();
    map.queryRenderedFeatures.mockReturnValueOnce([{ id: 'feature' }]);
    seedVessels([VESSEL_ONE]);
    const { onClose } = renderPopup(map, {
      mmsi: VESSEL_ONE.mmsi,
      vesselId: null,
      anchorLngLat: [30, 43],
    });

    act(() => {
      map.clickHandlers[0]?.({ point: { x: 10, y: 20 } });
    });

    await waitFor(() => {
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('closes from the popup close button', async () => {
    const map = createMockMap();
    seedVessels([VESSEL_ONE]);
    const { onClose } = renderPopup(map, {
      mmsi: VESSEL_ONE.mmsi,
      vesselId: null,
      anchorLngLat: [30, 43],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Close vessel details' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tracks updated vessel coordinates with the same popup instance', async () => {
    const map = createMockMap();
    seedVessels([VESSEL_ONE]);
    renderPopup(map, {
      mmsi: VESSEL_ONE.mmsi,
      vesselId: null,
      anchorLngLat: [30, 43],
    });

    expect(await screen.findByText('VESSEL ONE')).toBeInTheDocument();
    expect(popupState.instances).toHaveLength(1);
    expect(popupState.instances[0]?.setLngLat).toHaveBeenLastCalledWith([30, 43]);

    await act(async () => {
      useVesselsStore.setState((state) => {
        const next = new Map(state.vessels);
        next.set(VESSEL_ONE.mmsi, {
          ...next.get(VESSEL_ONE.mmsi)!,
          lat: 45.5,
          lon: 32.25,
        });
        return { vessels: next };
      });
      await Promise.resolve();
    });

    expect(popupState.instances[0]?.setLngLat).toHaveBeenLastCalledWith([32.25, 45.5]);
    expect(popupState.instances).toHaveLength(1);
  });
});
