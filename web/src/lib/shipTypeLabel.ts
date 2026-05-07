const EXACT: Partial<Record<number, string>> = {
  0: 'Unknown',
  30: 'Fishing',
  31: 'Towing',
  32: 'Towing',
  33: 'Dredging / Underwater Ops',
  34: 'Diving Ops',
  35: 'Military Ops',
  36: 'Sailing',
  37: 'Pleasure Craft',
  50: 'Pilot Vessel',
  51: 'SAR Vessel',
  52: 'Tug',
  53: 'Port Tender',
  54: 'Anti-Pollution',
  55: 'Law Enforcement',
  56: 'Local Vessel',
  57: 'Local Vessel',
  58: 'Medical Transport',
  59: 'Non-combatant',
};

export function shipTypeLabel(code: number | null): string {
  if (code === null) return '—';
  if (code < 0 || code > 99) return 'Unknown';
  if (code >= 20 && code <= 29) return 'Wing in Ground';
  if (code >= 40 && code <= 49) return 'High Speed Craft';
  if (code >= 60 && code <= 69) return 'Passenger';
  if (code >= 70 && code <= 79) return 'Cargo';
  if (code >= 80 && code <= 89) return 'Tanker';
  if (code >= 90 && code <= 99) return 'Other';
  if (code in EXACT) return EXACT[code]!;
  return 'Unknown';
}
