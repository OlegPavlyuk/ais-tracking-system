import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { useVesselsStore } from './store/vessels';

const mocks = vi.hoisted(() => ({
  fetchVessels: vi.fn(),
  mapReady: null as ((map: unknown) => void) | null,
  wsStart: vi.fn(),
  wsStop: vi.fn(),
}));

vi.mock('./map/MapView', () => ({
  MapView: ({ onReady }: { onReady: (map: unknown) => void }) => {
    mocks.mapReady = onReady;
    return null;
  },
}));

vi.mock('./map/useVesselsLayer', () => ({ useVesselsLayer: vi.fn() }));
vi.mock('./map/useVesselClick', () => ({ useVesselClick: vi.fn() }));
vi.mock('./map/useVesselHover', () => ({ useVesselHover: vi.fn() }));
vi.mock('./components/StatusPill', () => ({ StatusPill: () => null }));
vi.mock('./components/VesselDetailPanel', () => ({ VesselDetailPanel: () => null }));
vi.mock('./components/MapLegend', () => ({ MapLegend: () => null }));
vi.mock('./api/client', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client');
  return {
    ...actual,
    fetchVessels: mocks.fetchVessels,
  };
});
vi.mock('./lib/wsClient', () => ({
  buildWsUrl: () => 'ws://localhost/ws/positions',
  WsClient: class MockWsClient {
    start = mocks.wsStart;
    stop = mocks.wsStop;
  },
}));

describe('App bootstrap', () => {
  beforeEach(() => {
    mocks.fetchVessels.mockReset();
    mocks.mapReady = null;
    mocks.wsStart.mockReset();
    mocks.wsStop.mockReset();
    useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
  });

  afterEach(() => {
    useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
  });

  it('starts data bootstrap before the map becomes ready', async () => {
    let resolveFetch: ((value: { vessels: [] }) => void) | null = null;
    const fetchPromise = new Promise<{ vessels: [] }>((resolve) => {
      resolveFetch = resolve;
    });
    mocks.fetchVessels.mockReturnValue(fetchPromise);

    render(<App />);

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });
    expect(mocks.wsStart).toHaveBeenCalledWith();

    await act(async () => {
      resolveFetch?.({ vessels: [] });
      await fetchPromise;
    });

    expect(mocks.fetchVessels).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('does not re-bootstrap when the map becomes ready later', async () => {
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });

    render(<App />);

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.mapReady?.({ getZoom: () => 5 });
      await Promise.resolve();
    });

    expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    expect(mocks.wsStart).toHaveBeenCalledTimes(1);
  });

  it('shows a generic error alert for snapshot failures', async () => {
    let rejectFetch: ((reason?: unknown) => void) | null = null;
    const fetchPromise = new Promise<never>((_resolve, reject) => {
      rejectFetch = reject;
    });
    mocks.fetchVessels.mockReturnValue(fetchPromise);

    render(<App />);

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rejectFetch?.(new Error('boom'));
      try {
        await fetchPromise;
      } catch {
        // expected in test
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('boom');
    });
  });
});
