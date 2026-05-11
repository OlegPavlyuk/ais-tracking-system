import { useEffect } from 'react';
import maplibregl, { type Map as MlMap, type MapMouseEvent } from 'maplibre-gl';
import { MapViewIds } from './mapViewIds';
import { relativeTime } from '@/lib/relativeTime';

const QUERY_RADIUS = 4; // px around cursor

function buildPopupContent(props: Record<string, unknown>): HTMLElement {
  const title = String(props.vesselName ?? props.mmsi ?? '');
  const status = String(props.navStatusLabel ?? '—');
  const lastSeen = relativeTime(typeof props.occurredAt === 'string' ? props.occurredAt : null);

  const root = document.createElement('div');
  root.style.cssText = 'font-size:12px;line-height:1.6;min-width:130px';

  const h = document.createElement('div');
  h.style.cssText = 'font-weight:600;margin-bottom:1px';
  h.textContent = title;
  root.appendChild(h);

  const s = document.createElement('div');
  s.style.cssText = 'color:#64748b';
  s.textContent = status;
  root.appendChild(s);

  const t = document.createElement('div');
  t.style.cssText = 'color:#64748b';
  t.textContent = `Updated ${lastSeen}`;
  root.appendChild(t);

  return root;
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

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      maxWidth: '220px',
    });

    // Disable pointer events once on open so the popup never blocks mousemove
    // events from reaching the map canvas beneath it.
    popup.on('open', () => {
      const el = popup.getElement();
      if (el) el.style.pointerEvents = 'none';
    });

    const layerIds = [MapViewIds.vesselsLayerId, MapViewIds.vesselCircleLayerId];

    let pendingPoint: { x: number; y: number } | null = null;
    let rafId: number | null = null;
    let currentSig: string | null = null;

    const process = () => {
      rafId = null;
      const pt = pendingPoint;
      pendingPoint = null;
      if (!pt) return;

      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [pt.x - QUERY_RADIUS, pt.y - QUERY_RADIUS],
        [pt.x + QUERY_RADIUS, pt.y + QUERY_RADIUS],
      ];
      const features = map.queryRenderedFeatures(bbox, { layers: layerIds });

      if (!features.length) {
        if (currentSig !== null) {
          popup.remove();
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
      popup
        .setLngLat(coords as [number, number])
        .setDOMContent(buildPopupContent(props))
        .addTo(map);
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
      popup.remove();
      currentSig = null;
    };

    map.on('mousemove', moveHandler);
    map.on('mouseout', outHandler);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.off('mousemove', moveHandler);
      map.off('mouseout', outHandler);
      popup.remove();
    };
  }, [disabled, map]);
}
