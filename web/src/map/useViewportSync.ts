import { useEffect } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { useVesselsStore } from '@/store/vessels';
import type { Bbox } from '@/lib/protocol';

export function useViewportSync(map: MlMap | null): void {
  const setBbox = useVesselsStore((s) => s.setBbox);

  useEffect(() => {
    if (!map) return;
    const emit = () => {
      const b = map.getBounds();
      const bbox: Bbox = {
        minLon: b.getWest(),
        minLat: b.getSouth(),
        maxLon: b.getEast(),
        maxLat: b.getNorth(),
      };
      setBbox(bbox);
    };
    emit();
    map.on('moveend', emit);
    map.on('zoomend', emit);
    return () => {
      map.off('moveend', emit);
      map.off('zoomend', emit);
    };
  }, [map, setBbox]);
}
