import { useEffect, useRef } from 'react';
import maplibregl, { type IControl, type Map as MlMap } from 'maplibre-gl';
import { MapViewIds } from './mapViewIds';

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER: [number, number] = [20, 40];
const DEFAULT_ZOOM = 4;

const VESSEL_ICON_ID = MapViewIds.vesselIconId;
const VESSELS_SOURCE_ID = MapViewIds.vesselsSourceId;
const VESSELS_LAYER_ID = MapViewIds.vesselsLayerId;
const VESSELS_SANCTIONS_HALO_LAYER_ID = MapViewIds.vesselSanctionsHaloLayerId;
const VESSELS_CIRCLE_LAYER_ID = MapViewIds.vesselCircleLayerId;

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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new ZoomLevelControl(), 'bottom-right');

    let cancelled = false;
    map.on('load', () => {
      void registerVesselIcon(map).then(() => {
        if (cancelled) return;
        addVesselsSource(map);
        addVesselsSanctionsHaloLayer(map);
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

class ZoomLevelControl implements IControl {
  private map: MlMap | null = null;
  private container: HTMLDivElement | null = null;
  private zoomValue: HTMLDivElement | null = null;

  onAdd(map: MlMap): HTMLElement {
    this.map = map;
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group zoom-level-control';

    const zoomInButton = document.createElement('button');
    zoomInButton.type = 'button';
    zoomInButton.className = 'zoom-level-control-button';
    zoomInButton.setAttribute('aria-label', 'Zoom in');
    zoomInButton.textContent = '+';
    zoomInButton.addEventListener('click', this.handleZoomIn);

    const zoomValue = document.createElement('div');
    zoomValue.className = 'zoom-level-control-value';

    const zoomOutButton = document.createElement('button');
    zoomOutButton.type = 'button';
    zoomOutButton.className = 'zoom-level-control-button';
    zoomOutButton.setAttribute('aria-label', 'Zoom out');
    zoomOutButton.textContent = '-';
    zoomOutButton.addEventListener('click', this.handleZoomOut);

    container.append(zoomInButton, zoomValue, zoomOutButton);
    map.on('zoom', this.updateZoomValue);
    this.container = container;
    this.zoomValue = zoomValue;
    this.updateZoomValue();

    return container;
  }

  onRemove(): void {
    this.map?.off('zoom', this.updateZoomValue);
    this.container?.remove();
    this.map = null;
    this.container = null;
    this.zoomValue = null;
  }

  private readonly handleZoomIn = () => {
    if (!this.map) return;
    this.map.easeTo({ zoom: Math.round(this.map.getZoom()) + 1 });
  };

  private readonly handleZoomOut = () => {
    if (!this.map) return;
    this.map.easeTo({ zoom: Math.round(this.map.getZoom()) - 1 });
  };

  private readonly updateZoomValue = () => {
    if (!this.map || !this.zoomValue) return;
    this.zoomValue.textContent = this.map.getZoom().toFixed(1);
  };
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

function addVesselsSanctionsHaloLayer(map: MlMap): void {
  if (!map.getLayer(VESSELS_SANCTIONS_HALO_LAYER_ID)) {
    map.addLayer({
      id: VESSELS_SANCTIONS_HALO_LAYER_ID,
      type: 'circle',
      source: VESSELS_SOURCE_ID,
      filter: [
        'any',
        ['==', ['get', 'sanctionsStatus'], 'candidate'],
        ['==', ['get', 'sanctionsStatus'], 'sanctioned'],
      ],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          ['case', ['==', ['get', 'sanctionsStatus'], 'sanctioned'], 13, 11],
          10,
          ['case', ['==', ['get', 'sanctionsStatus'], 'sanctioned'], 18, 15],
          14,
          ['case', ['==', ['get', 'sanctionsStatus'], 'sanctioned'], 25, 21],
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'sanctionsStatus'], 'sanctioned'],
          '#DC2626',
          '#F59E0B',
        ],
        'circle-opacity': [
          'case',
          ['==', ['get', 'sanctionsStatus'], 'sanctioned'],
          0.16,
          0.1,
        ],
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'sanctionsStatus'], 'sanctioned'],
          '#DC2626',
          '#F59E0B',
        ],
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'sanctionsStatus'], 'sanctioned'],
          2.5,
          1.75,
        ],
        'circle-stroke-opacity': [
          'case',
          ['==', ['get', 'sanctionsStatus'], 'sanctioned'],
          0.85,
          0.7,
        ],
      },
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
