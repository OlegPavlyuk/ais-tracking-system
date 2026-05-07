import { SHIP_TYPE_LEGEND } from '@/lib/shipTypeColor';

export function MapLegend() {
  return (
    <div className="absolute bottom-4 left-2 z-50 pointer-events-none select-none rounded-lg bg-slate-900/85 px-3 py-2 text-xs text-slate-200 backdrop-blur-sm">
      <p className="mb-1.5 font-semibold uppercase tracking-wide text-slate-400">
        Vessel type
      </p>
      <ul className="space-y-1">
        {SHIP_TYPE_LEGEND.map(({ category, color }) => (
          <li key={category} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {category}
          </li>
        ))}
      </ul>
    </div>
  );
}
