import { useEffect } from 'react';
import type { Map as MlMap, MapMouseEvent, PointLike } from 'maplibre-gl';
import { MapViewIds } from './mapViewIds';
import { relativeTime } from '@/lib/relativeTime';

const QUERY_RADIUS = 4; // px around cursor
const TOOLTIP_OFFSET = 12;
const TOOLTIP_MARGIN = 8;

function buildPopupContent(props: Record<string, unknown>): HTMLElement {
  const title = String(props.vesselName ?? props.mmsi ?? '');
  const status = String(props.navStatusLabel ?? '—');
  const lastSeen = relativeTime(typeof props.occurredAt === 'string' ? props.occurredAt : null);

  const root = document.createElement('div');
  root.className = 'vessel-hover-card';

  const h = document.createElement('div');
  h.className = 'vessel-hover-card-title';
  h.textContent = title;
  root.appendChild(h);

  const s = document.createElement('div');
  s.className = 'vessel-hover-card-row';
  s.textContent = status;
  root.appendChild(s);

  const t = document.createElement('div');
  t.className = 'vessel-hover-card-row';
  t.textContent = `Updated ${lastSeen}`;
  root.appendChild(t);

  return root;
}

function createTooltipOverlay(map: MlMap): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'vessel-hover-overlay';
  overlay.hidden = true;
  map.getContainer().appendChild(overlay);
  return overlay;
}

function hideTooltip(overlay: HTMLElement): void {
  overlay.hidden = true;
  overlay.replaceChildren();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function placeTooltipOverlay(map: MlMap, overlay: HTMLElement, coords: [number, number]): void {
  const container = map.getContainer();
  const point = map.project(coords);

  const width = overlay.offsetWidth;
  const height = overlay.offsetHeight;
  const maxLeft = Math.max(TOOLTIP_MARGIN, container.clientWidth - width - TOOLTIP_MARGIN);
  const maxTop = Math.max(TOOLTIP_MARGIN, container.clientHeight - height - TOOLTIP_MARGIN);

  const preferredLeft = point.x - width / 2;
  const preferredTop = point.y - height - TOOLTIP_OFFSET;
  const fallbackTop = point.y + TOOLTIP_OFFSET;

  const left = preferredLeft;
  const top = preferredTop >= TOOLTIP_MARGIN ? preferredTop : fallbackTop;

  overlay.style.left = `${Math.round(clamp(left, TOOLTIP_MARGIN, maxLeft))}px`;
  overlay.style.top = `${Math.round(clamp(top, TOOLTIP_MARGIN, maxTop))}px`;
}

function showTooltip(map: MlMap, overlay: HTMLElement, props: Record<string, unknown>, coords: [number, number]): void {
  overlay.replaceChildren(buildPopupContent(props));
  overlay.hidden = false;
  placeTooltipOverlay(map, overlay, coords);
}

// Signature that changes whenever popup content needs to refresh:
// vessel identity + last update time + nav status + current map position.
function featureSig(props: Record<string, unknown>, coords: [number, number]): string {
  return [
    String(props.mmsi ?? ''),
    String(props.occurredAt ?? ''),
    String(props.navStatusLabel ?? ''),
    coords[0].toFixed(5),
    coords[1].toFixed(5),
  ].join('|');
}

export function useVesselHover(map: MlMap | null, disabled = false): void {
  useEffect(() => {
    if (!map || disabled) return;

    const overlay = createTooltipOverlay(map);
    const layerIds = [MapViewIds.vesselsLayerId, MapViewIds.vesselCircleLayerId];

    let pendingPoint: { x: number; y: number } | null = null;
    let rafId: number | null = null;
    let currentSig: string | null = null;

    const process = () => {
      rafId = null;
      const pt = pendingPoint;
      pendingPoint = null;
      if (!pt) return;

      const bbox: [PointLike, PointLike] = [
        [pt.x - QUERY_RADIUS, pt.y - QUERY_RADIUS],
        [pt.x + QUERY_RADIUS, pt.y + QUERY_RADIUS],
      ];
      const features = map.queryRenderedFeatures(bbox, { layers: layerIds });

      if (!features.length) {
        if (currentSig !== null) {
          hideTooltip(overlay);
          currentSig = null;
        }
        return;
      }

      // Pick the feature whose map-projected centre is closest to the cursor.
      let best = features[0]!;
      let bestDistSq = Infinity;
      for (const f of features) {
        const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
        const p = map.project(coords as [number, number]);
        const dx = p.x - pt.x;
        const dy = p.y - pt.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = f;
        }
      }

      const props = best.properties;
      if (!props) return;
      const coords = (best.geometry as unknown as { coordinates: [number, number] }).coordinates;
      const sig = featureSig(props, coords as [number, number]);
      if (sig === currentSig) return;

      currentSig = sig;
      showTooltip(map, overlay, props, coords as [number, number]);
    };

    const moveHandler = (e: MapMouseEvent) => {
      pendingPoint = e.point;
      if (rafId === null) {
        rafId = requestAnimationFrame(process);
      }
    };

    const outHandler = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingPoint = null;
      hideTooltip(overlay);
      currentSig = null;
    };

    map.on('mousemove', moveHandler);
    map.on('mouseout', outHandler);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.off('mousemove', moveHandler);
      map.off('mouseout', outHandler);
      overlay.remove();
    };
  }, [disabled, map]);
}
