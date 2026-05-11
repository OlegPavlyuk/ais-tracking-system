import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import maplibregl, { type LngLatLike, type Map as MlMap, type MapMouseEvent } from 'maplibre-gl';
import { MapViewIds } from '@/map/mapViewIds';
import { useVesselsStore } from '@/store/vessels';
import { VesselDetailContent } from './VesselDetailContent';

const CLICK_QUERY_RADIUS = 4;

interface SelectedVessel {
  mmsi: string;
  vesselId: string | null;
  anchorLngLat: [number, number];
}

interface Props {
  map: MlMap;
  selectedVessel: SelectedVessel;
  onClose: () => void;
}

function hasVesselAtClick(map: MlMap, event: MapMouseEvent): boolean {
  const bbox: [[number, number], [number, number]] = [
    [event.point.x - CLICK_QUERY_RADIUS, event.point.y - CLICK_QUERY_RADIUS],
    [event.point.x + CLICK_QUERY_RADIUS, event.point.y + CLICK_QUERY_RADIUS],
  ];

  return (
    map.queryRenderedFeatures(bbox, {
      layers: [MapViewIds.vesselsLayerId, MapViewIds.vesselCircleLayerId],
    }).length > 0
  );
}

export function VesselDetailPopup({ map, selectedVessel, onClose }: Props) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const lastKnownAnchorRef = useRef<LngLatLike>(selectedVessel.anchorLngLat);
  onCloseRef.current = onClose;

  if (containerRef.current === null) {
    containerRef.current = document.createElement('div');
  }

  const vessel = useVesselsStore((state) => state.vessels.get(selectedVessel.mmsi));

  const liveAnchor = useMemo<[number, number] | null>(() => {
    if (vessel?.lat === null || vessel?.lat === undefined) return null;
    if (vessel?.lon === null || vessel?.lon === undefined) return null;
    return [vessel.lon, vessel.lat];
  }, [vessel?.lat, vessel?.lon]);

  useEffect(() => {
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      maxWidth: 'none',
      className: 'vessel-detail-popup',
    });
    popupRef.current = popup;

    popup
      .setDOMContent(containerRef.current!)
      .setLngLat(lastKnownAnchorRef.current)
      .addTo(map);

    const handleMapClick = (event: MapMouseEvent) => {
      if (!hasVesselAtClick(map, event)) {
        onCloseRef.current();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const popupElement = popup.getElement();
      const mapContainer = map.getContainer();

      if (!(target instanceof Node)) return;
      if (popupElement.contains(target)) return;
      if (mapContainer.contains(target)) return;

      onCloseRef.current();
    };

    map.on('click', handleMapClick);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      map.off('click', handleMapClick);
      document.removeEventListener('pointerdown', handlePointerDown);
      popup.remove();
      popupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    lastKnownAnchorRef.current = selectedVessel.anchorLngLat;
    popupRef.current?.setLngLat(lastKnownAnchorRef.current);
  }, [selectedVessel.anchorLngLat, selectedVessel.mmsi, selectedVessel.vesselId]);

  useEffect(() => {
    if (liveAnchor === null) return;
    lastKnownAnchorRef.current = liveAnchor;
    popupRef.current?.setLngLat(liveAnchor);
  }, [liveAnchor]);

  return createPortal(
    <VesselDetailContent
      mmsi={selectedVessel.mmsi}
      vesselId={selectedVessel.vesselId}
      onClose={onClose}
    />,
    containerRef.current,
  );
}
