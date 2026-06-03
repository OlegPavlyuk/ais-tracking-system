import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from './App';
import { useVesselsStore } from './store/vessels';

const mocks = vi.hoisted(() => ({
  mapReady: null as ((map: unknown) => void) | null,
  mapError: null as ((error: Error) => void) | null,
  useVesselRealtimeSync: vi.fn(),
}));

vi.mock('./map/MapView', () => ({
  MapView: ({
    onReady,
    onError,
  }: {
    onReady: (map: unknown) => void;
    onError?: (error: Error) => void;
  }) => {
    mocks.mapReady = onReady;
    mocks.mapError = onError ?? null;
    return null;
  },
}));

vi.mock('./map/useVesselsLayer', () => ({ useVesselsLayer: vi.fn() }));
vi.mock('./map/useVesselClick', () => ({ useVesselClick: vi.fn() }));
vi.mock('./map/useVesselHover', () => ({ useVesselHover: vi.fn() }));
vi.mock('./components/StatusPill', () => ({ StatusPill: () => null }));
vi.mock('./components/VesselDetailPopup', () => ({ VesselDetailPopup: () => null }));
vi.mock('./components/MapLegend', () => ({ MapLegend: () => null }));
vi.mock('./realtime/useVesselRealtimeSync', () => ({
  useVesselRealtimeSync: mocks.useVesselRealtimeSync,
}));

describe('App', () => {
  beforeEach(() => {
    mocks.mapReady = null;
    mocks.mapError = null;
    mocks.useVesselRealtimeSync.mockReset();
    useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
    });
  });

  it('starts realtime synchronization while rendering the map shell', () => {
    render(<App />);

    expect(mocks.useVesselRealtimeSync).toHaveBeenCalledTimes(1);
  });

  it('shows a map initialization error alert', async () => {
    render(<App />);

    await act(async () => {
      mocks.mapError?.(new Error('Map failed to initialize: bad style'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('bad style');
  });
});
