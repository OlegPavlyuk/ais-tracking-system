const STATIONARY_CODES = new Set([1, 5, 6]);
// 15 = "Not defined / default" — treat as unknown for SOG fallback purposes
const UNKNOWN_CODES = new Set([null, 15]);
const SOG_STATIONARY_THRESHOLD = 0.3;

export function markerShape(
  navStatus: number | null,
  sog: number | null,
): 'arrow' | 'circle' {
  if (navStatus !== null && STATIONARY_CODES.has(navStatus)) return 'circle';
  if (UNKNOWN_CODES.has(navStatus) && sog !== null && sog <= SOG_STATIONARY_THRESHOLD)
    return 'circle';
  return 'arrow';
}
