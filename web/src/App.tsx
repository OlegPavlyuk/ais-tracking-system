import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { MapView } from './map/MapView';
import { useVesselsLayer } from './map/useVesselsLayer';
import { useVesselClick } from './map/useVesselClick';
import { useVesselHover } from './map/useVesselHover';
import { ErrorNotice } from './components/ErrorNotice';
import { StatusPill } from './components/StatusPill';
import { VesselDetailPanel } from './components/VesselDetailPanel';
import { MapLegend } from './components/MapLegend';
import { useVesselsStore } from './store/vessels';
import { ApiError, fetchVessels } from './api/client';
import { WsClient, buildWsUrl, type WsClientHandlers } from './lib/wsClient';

const WS_PATH = '/ws/positions';
const STALE_PRUNE_INTERVAL_MS = 60_000;

type SelectedVessel = { mmsi: string; vesselId: string | null };

export function App() {
  const [map, setMap] = useState<MlMap | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<SelectedVessel | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useVesselsLayer(map);
  useVesselClick(map, setSelectedVessel);
  useVesselHover(map);

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
          store.setError({ code: 'NETWORK', message: (err as Error).message ?? 'network error' });
        }
      });
  }, []);

  useEffect(() => {
    const handlers: WsClientHandlers = {
      onMessage: (msg) => {
        const store = useVesselsStore.getState();
        switch (msg.type) {
          case 'position':
            store.setError(null);
            store.applyPosition(msg.data);
            break;
          case 'static':
            store.setError(null);
            store.applyStatic(msg.data);
            break;
          case 'vessel.enriched':
            store.setError(null);
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

  return (
    <div className="relative h-full w-full">
      <MapView onReady={setMap} />
      <StatusPill />
      <ErrorNotice />
      <MapLegend />
      {selectedVessel && (
        <VesselDetailPanel
          mmsi={selectedVessel.mmsi}
          vesselId={selectedVessel.vesselId}
          onClose={() => setSelectedVessel(null)}
        />
      )}
    </div>
  );
}
