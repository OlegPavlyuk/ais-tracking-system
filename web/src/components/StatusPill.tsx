import { useVesselsStore, type WsStatus } from '@/store/vessels';
import clsx from 'clsx';

const LABELS: Record<WsStatus, string> = {
  idle: 'Connecting...',
  connecting: 'Connecting...',
  open: 'Live',
  reconnecting: 'Reconnecting...',
  closed: 'Disconnected',
};

const COLORS: Record<WsStatus, string> = {
  idle: 'bg-yellow-500/90',
  connecting: 'bg-yellow-500/90',
  open: 'bg-emerald-500/90',
  reconnecting: 'bg-yellow-500/90',
  closed: 'bg-rose-500/90',
};

export function StatusPill() {
  const status = useVesselsStore((s) => s.wsStatus);
  return (
    <div
      className={clsx(
        'absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-medium text-white shadow',
        COLORS[status],
      )}
      role="status"
      aria-live="polite"
    >
      {LABELS[status]}
    </div>
  );
}
