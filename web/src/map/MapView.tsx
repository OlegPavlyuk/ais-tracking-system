import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { getSupportedBbox } from '@/lib/coverageBbox';
import type { Bbox } from '@/lib/protocol';

const FALLBACK_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const VESSEL_ICON_ID = 'vessel-default';
const VESSELS_SOURCE_ID = 'vessels';
const VESSELS_LAYER_ID = 'vessels';
const COVERAGE_SOURCE_ID = 'coverage-area';
const COVERAGE_LAYER_ID = 'coverage-area-outline';

// Inline 24x24 north-pointing arrow. Rasterized via map.addImage for the symbol layer.
const VESSEL_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="#22d3ee" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

interface MapViewProps {
  onReady: (map: MlMap) => void;
}

export function MapView({ onReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current) return;
    const styleUrl = import.meta.env.VITE_MAP_STYLE_URL ?? FALLBACK_STYLE_URL;
    const supportedBbox = getSupportedBbox();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [
        (supportedBbox.minLon + supportedBbox.maxLon) / 2,
        (supportedBbox.minLat + supportedBbox.maxLat) / 2,
      ],
      zoom: 5,
      attributionControl: { compact: true },
    });

    map.on('load', () => {
      map.fitBounds(
        [
          [supportedBbox.minLon, supportedBbox.minLat],
          [supportedBbox.maxLon, supportedBbox.maxLat],
        ],
        { padding: 40, duration: 0 },
      );

      registerVesselIcon(map);
      addCoverageOutline(map, supportedBbox);
      addVesselsLayer(map);

      onReadyRef.current(map);
    });

    return () => {
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function registerVesselIcon(map: MlMap): void {
  if (map.hasImage(VESSEL_ICON_ID)) return;
  const img = new Image(24, 24);
  const blob = new Blob([VESSEL_SVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    if (!map.hasImage(VESSEL_ICON_ID)) {
      map.addImage(VESSEL_ICON_ID, img, { pixelRatio: 1 });
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function addVesselsLayer(map: MlMap): void {
  if (!map.getSource(VESSELS_SOURCE_ID)) {
    map.addSource(VESSELS_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(VESSELS_LAYER_ID)) {
    map.addLayer({
      id: VESSELS_LAYER_ID,
      type: 'symbol',
      source: VESSELS_SOURCE_ID,
      layout: {
        'icon-image': VESSEL_ICON_ID,
        'icon-rotate': ['coalesce', ['get', 'rotation'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': 1,
      },
    });
  }
}

function addCoverageOutline(map: MlMap, bbox: Bbox): void {
  const ring: [number, number][] = [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.maxLon, bbox.maxLat],
    [bbox.minLon, bbox.maxLat],
    [bbox.minLon, bbox.minLat],
  ];
  if (!map.getSource(COVERAGE_SOURCE_ID)) {
    map.addSource(COVERAGE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: ring },
      },
    });
  }
  if (!map.getLayer(COVERAGE_LAYER_ID)) {
    map.addLayer({
      id: COVERAGE_LAYER_ID,
      type: 'line',
      source: COVERAGE_SOURCE_ID,
      paint: {
        'line-color': '#94a3b8',
        'line-width': 1,
        'line-dasharray': [4, 4],
        'line-opacity': 0.6,
      },
    });
  }
}

export const MapViewIds = {
  vesselsSourceId: VESSELS_SOURCE_ID,
  vesselsLayerId: VESSELS_LAYER_ID,
  vesselIconId: VESSEL_ICON_ID,
};
