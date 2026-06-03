import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frontendMetrics } from '@/lib/frontendMetrics';
import { useVesselsStore } from '@/store/vessels';
import { useVesselRealtimeSync } from './useVesselRealtimeSync';

const mocks = vi.hoisted(() => ({
  fetchVessels: vi.fn(),
  wsHandlers: null as {
    onMessage: (msg: unknown) => void;
    onStatus: (status: string) => void;
    onResync: () => void;
  } | null,
  wsStart: vi.fn(),
  wsStop: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    fetchVessels: mocks.fetchVessels,
  };
});

vi.mock('@/lib/wsClient', () => ({
  buildWsUrl: () => 'ws://localhost/ws/positions',
  WsClient: class MockWsClient {
    constructor(
      _opts: unknown,
      handlers: {
        onMessage: (msg: unknown) => void;
        onStatus: (status: string) => void;
        onResync: () => void;
      },
    ) {
      mocks.wsHandlers = handlers;
    }

    start = mocks.wsStart;
    stop = mocks.wsStop;
  },
}));

function HookHarness() {
  useVesselRealtimeSync();
  return null;
}

describe('useVesselRealtimeSync', () => {
  beforeEach(() => {
    mocks.fetchVessels.mockReset();
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

  it('starts the websocket and initial snapshot fetch on mount', async () => {
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });

    render(React.createElement(HookHarness));

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });
    expect(mocks.wsStart).toHaveBeenCalledTimes(1);
    expect(mocks.fetchVessels).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('applies a successful snapshot and clears a previous error', async () => {
    const timestamp = new Date().toISOString();
    mocks.fetchVessels.mockResolvedValue({
      vessels: [
        {
          id: 'vessel-a',
          mmsi: '123456789',
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
          occurredAt: timestamp,
          lastSeenAt: timestamp,
          sanctionsStatus: null,
          sanctionsCheckedAt: null,
        },
      ],
    });
    useVesselsStore.setState({
      error: { code: 'OLD_ERROR', message: 'previous failure' },
    });

    render(React.createElement(HookHarness));

    await waitFor(() => {
      expect(useVesselsStore.getState().vessels.get('123456789')?.name).toBe('ALPHA');
    });

    expect(useVesselsStore.getState().error).toBeNull();
  });

  it('records snapshot errors in the store', async () => {
    let rejectFetch: ((reason?: unknown) => void) | null = null;
    const fetchPromise = new Promise<never>((_resolve, reject) => {
      rejectFetch = reject;
    });
    mocks.fetchVessels.mockReturnValue(fetchPromise);

    render(React.createElement(HookHarness));

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
    });

    expect(useVesselsStore.getState().error?.message).toBe('boom');
  });

  it('uses a generic network message for non-Error snapshot failures', async () => {
    let rejectFetch: ((reason?: unknown) => void) | null = null;
    const fetchPromise = new Promise<never>((_resolve, reject) => {
      rejectFetch = reject;
    });
    mocks.fetchVessels.mockReturnValue(fetchPromise);

    render(React.createElement(HookHarness));

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rejectFetch?.('not an error object');
      try {
        await fetchPromise;
      } catch {
        // expected in test
      }
      await Promise.resolve();
    });

    expect(useVesselsStore.getState().error).toMatchObject({
      code: 'NETWORK',
      message: 'network error',
    });
  });

  it('runs a snapshot refresh when the websocket requests resync', async () => {
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });

    render(React.createElement(HookHarness));

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.wsHandlers?.onResync();
      await Promise.resolve();
    });

    expect(mocks.fetchVessels).toHaveBeenCalledTimes(2);
  });

  it('applies websocket messages and records realtime metrics', async () => {
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });

    render(React.createElement(HookHarness));

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

    const vessel = useVesselsStore.getState().vessels.get('123456789');
    expect(vessel?.lat).toBe(44);
    expect(vessel?.name).toBe('BRAVO');
    expect(vessel?.sanctionsStatus).toBe('clear');
    expect(useVesselsStore.getState().error?.message).toBe('stream failed');
    expect(frontendMetrics().realtime).toEqual({
      totalMessages: 4,
      positionMessages: 1,
      staticMessages: 1,
      enrichedMessages: 1,
      errorMessages: 1,
    });
  });

  it('updates websocket status in the store', async () => {
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });

    render(React.createElement(HookHarness));

    await waitFor(() => {
      expect(mocks.fetchVessels).toHaveBeenCalledTimes(1);
    });

    act(() => {
      mocks.wsHandlers?.onStatus('open');
    });

    expect(useVesselsStore.getState().wsStatus).toBe('open');
  });

  it('runs stale pruning on the existing interval', () => {
    vi.useFakeTimers();
    const originalPruneStale = useVesselsStore.getState().pruneStale;
    const pruneStale = vi.fn();
    mocks.fetchVessels.mockResolvedValue({ vessels: [] });
    useVesselsStore.setState({ pruneStale });

    try {
      render(React.createElement(HookHarness));

      act(() => {
        vi.advanceTimersByTime(59_999);
      });
      expect(pruneStale).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(pruneStale).toHaveBeenCalledTimes(1);
    } finally {
      useVesselsStore.setState({ pruneStale: originalPruneStale });
      vi.useRealTimers();
    }
  });

  it('stops the websocket and aborts the pending snapshot fetch on cleanup', async () => {
    const capturedSignals: AbortSignal[] = [];
    mocks.fetchVessels.mockImplementation((signal: AbortSignal) => {
      capturedSignals.push(signal);
      return new Promise<{ vessels: [] }>(() => {});
    });

    const { unmount } = render(React.createElement(HookHarness));

    await waitFor(() => {
      expect(capturedSignals).toHaveLength(1);
    });

    unmount();

    expect(mocks.wsStop).toHaveBeenCalledTimes(1);
    expect(capturedSignals[0]!.aborted).toBe(true);
  });
});
