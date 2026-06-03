import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { frontendMetrics } from './lib/frontendMetrics';
import { useVesselsStore } from './store/vessels';

const mocks = vi.hoisted(() => ({
  fetchVessels: vi.fn(),
  mapReady: null as ((map: unknown) => void) | null,
  mapError: null as ((error: Error) => void) | null,
  wsHandlers: null as { onMessage: (msg: unknown) => void } | null,
  wsStart: vi.fn(),
  wsStop: vi.fn(),
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
    constructor(_opts: unknown, handlers: { onMessage: (msg: unknown) => void }) {
      mocks.wsHandlers = handlers;
    }

    start = mocks.wsStart;
    stop = mocks.wsStop;
  },
}));

describe('App bootstrap', () => {
  beforeEach(() => {
    mocks.fetchVessels.mockReset();
    mocks.mapReady = null;
    mocks.mapError = null;
    mocks.wsHandlers = null;
    mocks.wsStart.mockReset();
    mocks.wsStop.mockReset();
    frontendMetrics().reset();
    useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
      frontendMetrics().reset();
    });
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

  it('shows a map initialization error alert', async () => {
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });

    render(<App />);

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.mapError?.(new Error('Map failed to initialize: bad style'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('bad style');
  });

  it('records realtime message throughput counters', async () => {
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });

    render(<App />);

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });

    act(() => {
      mocks.wsHandlers?.onMessage({
        type: 'position',
        data: {
          schemaVersion: 1,
          kind: 'position',
          mmsi: '123456789',
          lat: 44,
          lon: 31,
          sog: 12,
          cog: 100,
          trueHeading: 101,
          navStatus: 1,
          occurredAt: '2024-01-01T00:01:00.000Z',
          provider: 'test',
          ingestedAt: '2024-01-01T00:01:00.000Z',
        },
      });
      mocks.wsHandlers?.onMessage({
        type: 'static',
        data: {
          schemaVersion: 1,
          kind: 'static',
          mmsi: '123456789',
          imo: '7654321',
          name: 'BRAVO',
          callSign: 'CALL2',
          shipType: 80,
          destination: 'IST',
          occurredAt: '2024-01-01T00:01:30.000Z',
          provider: 'test',
          ingestedAt: '2024-01-01T00:01:30.000Z',
        },
      });
      mocks.wsHandlers?.onMessage({
        type: 'vessel.enriched',
        data: {
          schemaVersion: 1,
          kind: 'vessel.enriched',
          vesselId: 'vessel-a',
          mmsi: '123456789',
          status: 'clear',
          checkedAt: '2024-01-01T00:02:00.000Z',
          matches: [],
        },
      });
      mocks.wsHandlers?.onMessage({
        type: 'error',
        error: { code: 'WS_ERROR', message: 'stream failed' },
      });
    });

    expect(frontendMetrics().realtime).toEqual({
      totalMessages: 4,
      positionMessages: 1,
      staticMessages: 1,
      enrichedMessages: 1,
      errorMessages: 1,
    });
  });
});
