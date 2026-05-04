import { useVesselsStore } from '@/store/vessels';

export function CoverageBanner() {
  const error = useVesselsStore((s) => s.error);
  if (!error || error.code !== 'BBOX_OUT_OF_SCOPE') return null;
  return (
    <div
      className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-amber-500/95 px-4 py-2 text-sm font-medium text-slate-900 shadow"
      role="alert"
    >
      Outside supported coverage area.
    </div>
  );
}
