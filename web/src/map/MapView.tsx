import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { getSupportedBbox } from '@/lib/coverageBbox';
import type { Bbox } from '@/lib/protocol';
import { MapViewIds } from './mapViewIds';

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const COVERAGE_SOURCE_ID = 'coverage-area';
const COVERAGE_LAYER_ID = 'coverage-area-outline';

const VESSEL_ICON_ID = MapViewIds.vesselIconId;
const VESSELS_SOURCE_ID = MapViewIds.vesselsSourceId;
const VESSELS_LAYER_ID = MapViewIds.vesselsLayerId;
const VESSELS_CIRCLE_LAYER_ID = MapViewIds.vesselCircleLayerId;

// Rendered at 48×48 internal resolution with pixelRatio:2 so MapLibre displays it
// at 24 CSS px — same visible size as before but 2× the sampling precision for
// crisper SDF edges. Path is the original 24×24 arrow scaled 2× to match viewBox.
const VESSEL_ICON_SIZE = 48;
const VESSEL_ICON_PIXEL_RATIO = 2;
const VESSEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${VESSEL_ICON_SIZE}" height="${VESSEL_ICON_SIZE}" viewBox="0 0 48 48">
  <path d="M24 3 L38 42 L24 33 L10 42 Z" fill="white"/>
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
    const styleUrl = import.meta.env.VITE_MAP_STYLE_URL ?? DEFAULT_STYLE_URL;
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

    let cancelled = false;
    map.on('load', () => {
      map.fitBounds(
        [
          [supportedBbox.minLon, supportedBbox.minLat],
          [supportedBbox.maxLon, supportedBbox.maxLat],
        ],
        { padding: 40, duration: 0 },
      );

      addCoverageOutline(map, supportedBbox);
      // Icon must be registered before the symbol layer references it,
      // otherwise MapLibre logs "Image not found" on first paint.
      void registerVesselIcon(map).then(() => {
        if (cancelled) return;
        addVesselsSource(map);
        addVesselsCircleLayer(map);
        addVesselsArrowLayer(map);
        onReadyRef.current(map);
      });
    });

    return () => {
      cancelled = true;
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function registerVesselIcon(map: MlMap): Promise<void> {
  if (map.hasImage(VESSEL_ICON_ID)) return Promise.resolve();
  const blob = new Blob([VESSEL_SVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  return new Promise<void>((resolve, reject) => {
    const img = new Image(VESSEL_ICON_SIZE, VESSEL_ICON_SIZE);
    img.onload = () => {
      try {
        if (!map.hasImage(VESSEL_ICON_ID)) {
          map.addImage(VESSEL_ICON_ID, img, { pixelRatio: VESSEL_ICON_PIXEL_RATIO, sdf: true });
        }
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to rasterize vessel icon'));
    };
    img.src = url;
  });
}

function addVesselsSource(map: MlMap): void {
  if (!map.getSource(VESSELS_SOURCE_ID)) {
    map.addSource(VESSELS_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
}

function addVesselsCircleLayer(map: MlMap): void {
  if (!map.getLayer(VESSELS_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: VESSELS_CIRCLE_LAYER_ID,
      type: 'circle',
      source: VESSELS_SOURCE_ID,
      filter: ['==', ['get', 'markerShape'], 'circle'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 5, 14, 8],
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0f172a',
        'circle-stroke-opacity': 0.5,
      },
    });
  }
}

function addVesselsArrowLayer(map: MlMap): void {
  if (!map.getLayer(VESSELS_LAYER_ID)) {
    map.addLayer({
      id: VESSELS_LAYER_ID,
      type: 'symbol',
      source: VESSELS_SOURCE_ID,
      filter: ['==', ['get', 'markerShape'], 'arrow'],
      layout: {
        'icon-image': VESSEL_ICON_ID,
        'icon-rotate': ['coalesce', ['get', 'rotation'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': 1,
      },
      paint: {
        'icon-color': ['get', 'color'],
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

