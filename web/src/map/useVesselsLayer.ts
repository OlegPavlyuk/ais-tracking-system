import { useEffect } from 'react';
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import { useVesselsStore } from '@/store/vessels';
import { recordVesselSourceUpdate } from '@/lib/frontendMetrics';
import { buildFeatureCollection } from './buildFeatureCollection';
import { MapViewIds } from './mapViewIds';

export { buildFeatureCollection } from './buildFeatureCollection';
export type { VesselFeatureCollection } from './buildFeatureCollection';

const FLUSH_MS = 500;

export function useVesselsLayer(map: MlMap | null): void {
  useEffect(() => {
    if (!map) return;

    let lastFlush = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let pending = false;
    let disposed = false;
    let moving = false;
    let dirtyWhileMoving = false;

    const clearScheduled = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pending = false;
    };

    const flush = () => {
      timeoutId = null;
      if (disposed) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (disposed) return;
        if (moving) {
          dirtyWhileMoving = true;
          pending = false;
          return;
        }
        const source = map.getSource(MapViewIds.vesselsSourceId) as GeoJSONSource | undefined;
        if (source) {
          const vessels = useVesselsStore.getState().vessels;
          const buildStart = performance.now();
          const featureCollection = buildFeatureCollection(vessels);
          const buildDurationMs = performance.now() - buildStart;
          const setDataStart = performance.now();
          source.setData(featureCollection as unknown as Parameters<GeoJSONSource['setData']>[0]);
          const setDataDurationMs = performance.now() - setDataStart;
          recordVesselSourceUpdate({
            buildDurationMs,
            setDataDurationMs,
            vesselCount: vessels.size,
            featureCount: featureCollection.features.length,
          });
          lastFlush = performance.now();
        }
        pending = false;
      });
    };

    const schedule = (force = false) => {
      if (moving && !force) {
        dirtyWhileMoving = true;
        return;
      }
      if (pending) return;
      pending = true;
      const elapsed = performance.now() - lastFlush;
      const wait = force ? 0 : Math.max(0, FLUSH_MS - elapsed);
      timeoutId = setTimeout(flush, wait);
    };

    const handleMoveStart = () => {
      moving = true;
      dirtyWhileMoving = dirtyWhileMoving || pending;
      clearScheduled();
    };

    const handleMoveEnd = () => {
      moving = false;
      if (dirtyWhileMoving) {
        dirtyWhileMoving = false;
        schedule(true);
      }
    };

    map.on('movestart', handleMoveStart);
    map.on('moveend', handleMoveEnd);

    schedule();
    const unsub = useVesselsStore.subscribe((s, prev) => {
      if (s.vessels !== prev.vessels) schedule();
    });

    return () => {
      disposed = true;
      unsub();
      map.off('movestart', handleMoveStart);
      map.off('moveend', handleMoveEnd);
      clearScheduled();
    };
  }, [map]);
}
