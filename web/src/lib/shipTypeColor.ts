export interface ShipTypeLegendEntry {
  category: string;
  color: string;
}

interface CategoryConfig extends ShipTypeLegendEntry {
  matches: (code: number) => boolean;
}

const CATEGORIES: CategoryConfig[] = [
  { category: 'Cargo',               color: '#2ECC71', matches: (c) => c >= 70 && c <= 79 },
  { category: 'Tanker',              color: '#E53935', matches: (c) => c >= 80 && c <= 89 },
  { category: 'Passenger',           color: '#3498DB', matches: (c) => c >= 60 && c <= 69 },
  { category: 'Fishing',             color: '#E67E22', matches: (c) => c === 30 },
  { category: 'Military / Law Enf.', color: '#8E44AD', matches: (c) => c === 35 || c === 55 },
  {
    category: 'Tug / Service',
    color: '#1ABC9C',
    matches: (c) => (c >= 31 && c <= 34) || (c >= 50 && c <= 54) || (c >= 56 && c <= 59),
  },
  {
    category: 'High Speed / WIG',
    color: '#F1C40F',
    matches: (c) => (c >= 20 && c <= 29) || (c >= 40 && c <= 49),
  },
  { category: 'Sailing / Pleasure',  color: '#FF4FC3', matches: (c) => c === 36 || c === 37 },
  { category: 'Unknown / Other',     color: '#95A5A6', matches: () => true },
];

export const SHIP_TYPE_LEGEND: ShipTypeLegendEntry[] = CATEGORIES.map(({ category, color }) => ({
  category,
  color,
}));

export function shipTypeColor(code: number | null): string {
  if (code === null || code < 0 || code > 99) {
    return CATEGORIES[CATEGORIES.length - 1]!.color;
  }
  return CATEGORIES.find((cat) => cat.matches(code))!.color;
}
