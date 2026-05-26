import { useEffect } from 'react';
import type { Map as MlMap, MapMouseEvent, MapLayerMouseEvent } from 'maplibre-gl';
import { MapViewIds } from './mapViewIds';
import { useVesselsStore } from '@/store/vessels';

export function useVesselClick(
  map: MlMap | null,
  onSelect: (selection: {
    mmsi: string;
    vesselId: string | null;
    anchorLngLat: [number, number];
  }) => void,
): void {
  useEffect(() => {
    if (!map) return;

    const layerIds = [MapViewIds.vesselsLayerId, MapViewIds.vesselCircleLayerId];

    const clickHandler = (e: MapLayerMouseEvent) => {
      const mmsi = e.features?.[0]?.properties?.mmsi;
      const coordinates = (
        e.features?.[0]?.geometry as { coordinates?: [number, number] } | undefined
      )?.coordinates;
      if (typeof mmsi === 'string' && mmsi.length > 0) {
        const vesselId = useVesselsStore.getState().vessels.get(mmsi)?.vesselId ?? null;
        onSelect({
          mmsi,
          vesselId,
          anchorLngLat:
            Array.isArray(coordinates) && coordinates.length === 2
              ? coordinates
              : [e.lngLat.lng, e.lngLat.lat],
        });
      }
    };

    const enterHandler = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const leaveHandler = () => {
      map.getCanvas().style.cursor = '';
    };

    for (const layerId of layerIds) {
      map.on('click', layerId, clickHandler);
      map.on('mouseenter', layerId, enterHandler as (e: MapMouseEvent) => void);
      map.on('mouseleave', layerId, leaveHandler as (e: MapMouseEvent) => void);
    }

    return () => {
      for (const layerId of layerIds) {
        map.off('click', layerId, clickHandler);
        map.off('mouseenter', layerId, enterHandler as (e: MapMouseEvent) => void);
        map.off('mouseleave', layerId, leaveHandler as (e: MapMouseEvent) => void);
      }
    };
  }, [map, onSelect]);
}
