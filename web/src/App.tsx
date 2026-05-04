import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { MapView } from './map/MapView';
import { useVesselsLayer } from './map/useVesselsLayer';
import { useViewportSync } from './map/useViewportSync';
import { StatusPill } from './components/StatusPill';
import { CoverageBanner } from './components/CoverageBanner';
import { useVesselsStore } from './store/vessels';
import { useDebouncedBbox } from './hooks/useDebouncedBbox';
import { ApiError, fetchSnapshot } from './api/client';
import { WsClient, buildWsUrl, type WsClientHandlers } from './lib/wsClient';
import { bboxArea, bboxContains } from './lib/coverageBbox';
import type { Bbox } from './lib/protocol';

const WS_PATH = '/ws/positions';
const AREA_RATIO_MIN = 0.75;
const AREA_RATIO_MAX = 1.33;
const ZOOM_SIGNIFICANCE_THRESHOLD = 0.25;

export function App() {
  const [map, setMap] = useState<MlMap | null>(null);
  const wsRef = useRef<WsClient | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastFetchedBboxRef = useRef<Bbox | null>(null);
  const lastFetchedZoomRef = useRef<number | null>(null);
  const bootstrappedRef = useRef(false);

  const debouncedBbox = useDebouncedBbox(useVesselsStore((s) => s.bbox));

  useVesselsLayer(map);
  useViewportSync(map);

  const runFetch = useCallback((bbox: Bbox, zoom: number | null) => {
    const id = ++requestIdRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetchSnapshot(bbox, ctrl.signal)
      .then((res) => {
        if (id !== requestIdRef.current) return;
        const store = useVesselsStore.getState();
        store.applySnapshot(res.vessels);
        store.setError(null);
        lastFetchedBboxRef.current = bbox;
        lastFetchedZoomRef.current = zoom;
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (id !== requestIdRef.current) return;
        const store = useVesselsStore.getState();
        if (err instanceof ApiError) {
          store.setError({ code: err.code, message: err.message, details: err.details });
        } else {
          store.setError({ code: 'NETWORK', message: (err as Error).message ?? 'network error' });
        }
      });
  }, []);

  useEffect(() => {
    if (!map) return;

    const handlers: WsClientHandlers = {
      onMessage: (msg) => {
        const store = useVesselsStore.getState();
        switch (msg.type) {
          case 'position':
            store.applyPosition(msg.data);
            break;
          case 'static':
            store.applyStatic(msg.data);
            break;
          case 'vessel.enriched':
            store.applyEnriched(msg.data);
            break;
          case 'error':
            store.setError({
              code: msg.error.code,
              message: msg.error.message,
              details: msg.error.details,
            });
            break;
        }
      },
      onStatus: (s) => useVesselsStore.getState().setStatus(s),
      onResync: () => {
        const current = useVesselsStore.getState().bbox;
        if (current) runFetch(current, map.getZoom());
      },
    };

    const ws = new WsClient({ url: buildWsUrl(WS_PATH) }, handlers);
    wsRef.current = ws;

    const startIfReady = () => {
      if (bootstrappedRef.current) return;
      const bbox = useVesselsStore.getState().bbox;
      if (!bbox) return;
      bootstrappedRef.current = true;
      ws.start(bbox);
      runFetch(bbox, map.getZoom());
    };
    startIfReady();
    const unsubscribe = useVesselsStore.subscribe((s, prev) => {
      if (s.bbox !== prev.bbox) startIfReady();
    });

    return () => {
      unsubscribe();
      ws.stop();
      wsRef.current = null;
      abortRef.current?.abort();
      bootstrappedRef.current = false;
    };
  }, [map, runFetch]);

  useEffect(() => {
    if (!map || !wsRef.current || !debouncedBbox) return;
    if (!bootstrappedRef.current) return;
    wsRef.current.updateSubscription(debouncedBbox);

    const zoom = map.getZoom();
    const lastBbox = lastFetchedBboxRef.current;
    const lastZoom = lastFetchedZoomRef.current;
    const zoomChanged =
      lastZoom === null || Math.abs(lastZoom - zoom) >= ZOOM_SIGNIFICANCE_THRESHOLD;
    const significant =
      lastBbox === null ||
      zoomChanged ||
      !bboxContains(lastBbox, debouncedBbox) ||
      (() => {
        const lastArea = bboxArea(lastBbox);
        if (lastArea <= 0) return true;
        const ratio = bboxArea(debouncedBbox) / lastArea;
        return ratio < AREA_RATIO_MIN || ratio > AREA_RATIO_MAX;
      })();

    if (significant) runFetch(debouncedBbox, zoom);
  }, [map, debouncedBbox, runFetch]);

  return (
    <div className="relative h-full w-full">
      <MapView onReady={setMap} />
      <StatusPill />
      <CoverageBanner />
    </div>
  );
}
