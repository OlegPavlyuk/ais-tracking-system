import { useEffect } from 'react';
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import { useVesselsStore } from '@/store/vessels';
import { buildFeatureCollection } from './buildFeatureCollection';
import { MapViewIds } from './mapViewIds';

export { buildFeatureCollection } from './buildFeatureCollection';
export type { VesselFeatureCollection } from './buildFeatureCollection';

const FLUSH_MS = 100;

export function useVesselsLayer(map: MlMap | null): void {
  useEffect(() => {
    if (!map) return;

    let lastFlush = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let pending = false;
    let disposed = false;

    const flush = () => {
      timeoutId = null;
      if (disposed) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (disposed) return;
        const source = map.getSource(MapViewIds.vesselsSourceId) as GeoJSONSource | undefined;
        if (source) {
          source.setData(
            buildFeatureCollection(useVesselsStore.getState().vessels) as unknown as Parameters<
              GeoJSONSource['setData']
            >[0],
          );
          lastFlush = performance.now();
        }
        pending = false;
      });
    };

    const schedule = () => {
      if (pending) return;
      pending = true;
      const elapsed = performance.now() - lastFlush;
      const wait = Math.max(0, FLUSH_MS - elapsed);
      timeoutId = setTimeout(flush, wait);
    };

    schedule();
    const unsub = useVesselsStore.subscribe((s, prev) => {
      if (s.vessels !== prev.vessels) schedule();
    });

    return () => {
      disposed = true;
      unsub();
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [map]);
}
