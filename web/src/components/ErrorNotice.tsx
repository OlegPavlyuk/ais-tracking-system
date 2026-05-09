import { useVesselsStore } from '@/store/vessels';

export function ErrorNotice() {
  const error = useVesselsStore((s) => s.error);
  if (!error) return null;

  return (
    <div
      className="absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-md bg-rose-600/95 px-4 py-2 text-sm font-medium text-white shadow"
      role="alert"
    >
      {error.message}
    </div>
  );
}
