import { useEffect } from 'react';
import type { Map as MlMap, MapMouseEvent, MapLayerMouseEvent } from 'maplibre-gl';
import { MapViewIds } from './mapViewIds';

export function useVesselClick(
  map: MlMap | null,
  onSelect: (mmsi: string) => void,
): void {
  useEffect(() => {
    if (!map) return;

    const layerIds = [MapViewIds.vesselsLayerId, MapViewIds.vesselCircleLayerId];

    const clickHandler = (e: MapLayerMouseEvent) => {
      const mmsi = e.features?.[0]?.properties?.mmsi;
      if (typeof mmsi === 'string' && mmsi.length > 0) {
        onSelect(mmsi);
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
