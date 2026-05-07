export function relativeTime(isoString: string | null, now = Date.now()): string {
  if (!isoString) return '—';
  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) return '—';
  const diffMs = now - parsed;
  if (diffMs < 0) return 'just now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '< 1 min ago';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} d ago`;
}
