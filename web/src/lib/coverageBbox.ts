import type { Bbox } from './protocol';

export const FALLBACK_SUPPORTED_BBOX: Bbox = {
  minLon: 27.0,
  minLat: 40.5,
  maxLon: 42.5,
  maxLat: 47.5,
};

export function parseBboxString(raw: string): Bbox | null {
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (!isLon(minLon) || !isLon(maxLon) || !isLat(minLat) || !isLat(maxLat)) return null;
  if (!(minLon < maxLon) || !(minLat < maxLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

export function getSupportedBbox(): Bbox {
  const raw = import.meta.env.VITE_SUPPORTED_BBOX;
  if (!raw) return FALLBACK_SUPPORTED_BBOX;
  return parseBboxString(raw) ?? FALLBACK_SUPPORTED_BBOX;
}

export function bboxToQueryString(b: Bbox): string {
  return `${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`;
}

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon &&
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat
  );
}

export function bboxArea(b: Bbox): number {
  return (b.maxLon - b.minLon) * (b.maxLat - b.minLat);
}

// Clamp a viewport bbox to the supported coverage area. Returns null when there
// is no overlap (e.g. user panned far away). The backend enforces strict
// containment, and fitBounds(...) plus padding/aspect-ratio means getBounds()
// often exceeds the supported bbox by a sliver even on initial load.
export function clampBbox(b: Bbox, bounds: Bbox): Bbox | null {
  const minLon = Math.max(b.minLon, bounds.minLon);
  const minLat = Math.max(b.minLat, bounds.minLat);
  const maxLon = Math.min(b.maxLon, bounds.maxLon);
  const maxLat = Math.min(b.maxLat, bounds.maxLat);
  if (!(minLon < maxLon) || !(minLat < maxLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

export function bboxEquals(a: Bbox, b: Bbox): boolean {
  return (
    a.minLon === b.minLon &&
    a.minLat === b.minLat &&
    a.maxLon === b.maxLon &&
    a.maxLat === b.maxLat
  );
}

function isLon(n: number): boolean {
  return n >= -180 && n <= 180;
}

function isLat(n: number): boolean {
  return n >= -90 && n <= 90;
}
