import { useCallback, useEffect, useRef } from 'react';
import { ApiError, fetchVessels } from '@/api/client';
import { recordRealtimeMessage } from '@/lib/frontendMetrics';
import { WsClient, buildWsUrl, type WsClientHandlers } from '@/lib/wsClient';
import { useVesselsStore } from '@/store/vessels';

const WS_PATH = '/ws/positions';
const STALE_PRUNE_INTERVAL_MS = 60_000;

export function useVesselRealtimeSync(): void {
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const runFetch = useCallback(() => {
    const id = ++requestIdRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetchVessels(ctrl.signal)
      .then((res) => {
        if (id !== requestIdRef.current) return;
        const store = useVesselsStore.getState();
        store.applySnapshot(res.vessels);
        store.setError(null);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (id !== requestIdRef.current) return;
        const store = useVesselsStore.getState();
        if (err instanceof ApiError) {
          store.setError({ code: err.code, message: err.message, details: err.details });
        } else {
          const message = err instanceof Error ? err.message : 'network error';
          store.setError({ code: 'NETWORK', message });
        }
      });
  }, []);

  useEffect(() => {
    const handlers: WsClientHandlers = {
      onMessage: (msg) => {
        const store = useVesselsStore.getState();
        switch (msg.type) {
          case 'position':
            recordRealtimeMessage('position');
            store.setError(null);
            store.applyPosition(msg.data);
            break;
          case 'static':
            recordRealtimeMessage('static');
            store.setError(null);
            store.applyStatic(msg.data);
            break;
          case 'vessel.enriched':
            recordRealtimeMessage('vessel.enriched');
            store.setError(null);
            store.applyEnriched(msg.data);
            break;
          case 'error':
            recordRealtimeMessage('error');
            store.setError({
              code: msg.error.code,
              message: msg.error.message,
              details: msg.error.details,
            });
            break;
        }
      },
      onStatus: (s) => useVesselsStore.getState().setStatus(s),
      onResync: () => runFetch(),
    };

    const ws = new WsClient({ url: buildWsUrl(WS_PATH) }, handlers);
    ws.start();
    runFetch();
    const pruneTimer = window.setInterval(() => {
      useVesselsStore.getState().pruneStale();
    }, STALE_PRUNE_INTERVAL_MS);

    return () => {
      window.clearInterval(pruneTimer);
      ws.stop();
      abortRef.current?.abort();
    };
  }, [runFetch]);
}
