export function shipTypeLabel(code: number | null): string {
  if (code === null) return '—';
  if (code >= 60 && code <= 69) return 'Passenger';
  if (code >= 70 && code <= 79) return 'Cargo';
  if (code >= 80 && code <= 89) return 'Tanker';
  return `Type ${code}`;
}
