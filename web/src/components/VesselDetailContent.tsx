import { useEffect, useState, type ElementType } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle,
  Anchor,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Compass,
  Droplet,
  Fish,
  Gauge,
  Navigation,
  Package,
  Sailboat,
  Shield,
  Ship,
  Users,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { fetchVesselDetail } from '@/api/client';
import { navStatusLabel } from '@/lib/navStatusLabel';
import { relativeTime } from '@/lib/relativeTime';
import { shipTypeColor } from '@/lib/shipTypeColor';
import { shipTypeLabel } from '@/lib/shipTypeLabel';
import { useVesselsStore } from '@/store/vessels';
import type { VesselDetailRow, VesselSanctionMatch } from '@/store/types';

interface Props {
  mmsi: string;
  vesselId?: string | null;
  onClose: () => void;
}

type SanctionsStatus = 'clear' | 'candidate' | 'sanctioned' | null;

const vesselTypeIcons: Record<string, ElementType> = {
  Passenger: Users,
  Cargo: Package,
  Tanker: Droplet,
  Fishing: Fish,
  Tug: Anchor,
  'High Speed Craft': Zap,
  'Military Ops': Shield,
  'Law Enforcement': Shield,
  Sailing: Sailboat,
  'Pleasure Craft': Sailboat,
};

const sanctionsConfig: Record<
  Exclude<SanctionsStatus, null> | 'unchecked',
  { icon: ElementType; label: string; className: string }
> = {
  unchecked: {
    icon: Circle,
    label: 'Unchecked',
    className: 'border-slate-200 bg-slate-100 text-slate-500',
  },
  clear: {
    icon: CheckCircle2,
    label: 'No match',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  candidate: {
    icon: AlertTriangle,
    label: 'Candidate',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  sanctioned: {
    icon: XCircle,
    label: 'Sanctioned',
    className: 'border-red-200 bg-red-50 text-red-700',
  },
};

const labelClassName = 'text-[11px] uppercase tracking-wider text-slate-400';

function fmtFixed(value: number | null, digits: number): string {
  return value !== null ? value.toFixed(digits) : '—';
}

function fmtDeg(value: number | null): string {
  return value !== null ? `${value}°` : '—';
}

function formatUpdatedAt(value: string | null | undefined): string {
  return relativeTime(value ?? null);
}

function shortNavStatus(code: number | null): string {
  const label = navStatusLabel(code);
  const shortMap: Record<string, string> = {
    'Under way (engine)': 'Underway',
    'Under way sailing': 'Sailing',
    'At anchor': 'Anchored',
    'Restricted manoeuvrability': 'Restricted',
    'Not under command': 'NUC',
    'Engaged in fishing': 'Fishing',
    'Constrained by draught': 'Constrained',
    'Pushing ahead / towing alongside': 'Pushing',
    'AIS-SART / MOB-AIS / EPIRB-AIS': 'AIS-SART',
  };

  return shortMap[label] ?? label;
}

function SkeletonRow({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded bg-slate-200', className)} />;
}

function DataCell({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={clsx('min-w-0 px-3 py-1.5', className)}>
      <div className={clsx('mb-0.5', labelClassName)}>{label}</div>
      <div className="truncate text-sm font-medium text-slate-900">{value ?? '—'}</div>
    </div>
  );
}

function LiveDataItem({
  icon: Icon,
  value,
  unit,
  label,
}: {
  icon: ElementType;
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs" title={label}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />
      <span className="truncate font-medium text-slate-700">
        {value}
        {unit && value !== '—' && <span className="ml-0.5 text-slate-400">{unit}</span>}
      </span>
    </div>
  );
}

function SanctionsBadge({ status }: { status: SanctionsStatus }) {
  const config = sanctionsConfig[status ?? 'unchecked'];
  const Icon = config.icon;

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium',
        config.className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {config.label}
    </div>
  );
}

function sourceLabel(source: VesselSanctionMatch['source']): string {
  return source === 'ofac' ? 'OFAC' : 'OpenSanctions';
}

function matchMethodLabel(method: string): string {
  const normalizedMethod = method.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    imo: 'Match by IMO',
    mmsi: 'Match by MMSI',
    name_candidate: 'Match by name',
  };

  return labels[normalizedMethod] ?? `Match by ${method}`;
}

function MatchItem({ match }: { match: VesselSanctionMatch }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs">
      <span className="shrink-0 font-medium text-slate-700">{sourceLabel(match.source)}</span>
      <span className="text-right text-slate-600">{matchMethodLabel(match.matchMethod)}</span>
    </div>
  );
}

function SanctionsMatchList({ matches }: { matches: VesselSanctionMatch[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleMatches = expanded ? matches : matches.slice(0, 2);
  const hiddenCount = matches.length - visibleMatches.length;

  return (
    <div className="mt-2 space-y-1">
      <div className={labelClassName}>Match details</div>
      {visibleMatches.map((match) => (
        <MatchItem key={match.id} match={match} />
      ))}
      {matches.length > 2 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 flex items-center gap-1 text-xs text-sky-600 transition-colors hover:text-sky-700"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />+{hiddenCount} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

function LoadingHint() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
      <SkeletonRow className="h-3 w-20" />
      <span>Loading vessel details...</span>
    </div>
  );
}

export function VesselDetailContent({ mmsi, vesselId: initialVesselId = null, onClose }: Props) {
  const vessel = useVesselsStore((s) => s.vessels.get(mmsi));
  const vesselId = vessel?.vesselId ?? initialVesselId;

  const { data: queryData, isLoading } = useQuery({
    queryKey: ['vessel-detail', vesselId],
    queryFn: ({ signal }) => fetchVesselDetail(vesselId!, signal),
    enabled: !!vesselId,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!queryData) return;
    useVesselsStore.getState().applyDetailSanctions(queryData);
  }, [queryData]);

  const sanctionsStatus = vessel?.sanctionsStatus ?? queryData?.sanctionsStatus ?? null;
  const sanctionsMatches: VesselDetailRow['sanctionsMatches'] =
    vessel?.sanctionsMatches !== null && vessel?.sanctionsMatches !== undefined
      ? vessel.sanctionsMatches
      : (queryData?.sanctionsMatches ?? []);

  const isInStore = vessel !== undefined;
  const hasLivePosition =
    vessel?.lat !== null &&
    vessel?.lat !== undefined &&
    vessel?.lon !== null &&
    vessel?.lon !== undefined;

  const livePosition = hasLivePosition
    ? {
        sog: vessel.sog,
        cog: vessel.cog,
        trueHeading: vessel.trueHeading,
        navStatus: vessel.navStatus,
      }
    : null;

  const name = vessel?.name ?? queryData?.name;
  const headerTitle = name ?? `MMSI ${mmsi}`;
  const shipTypeCode = vessel?.shipType ?? queryData?.shipType ?? null;
  const shipType = shipTypeLabel(shipTypeCode);
  const vesselIconColor = shipTypeColor(shipTypeCode);
  const VesselIcon = vesselTypeIcons[shipType] ?? Ship;
  const destination = vessel?.destination ?? queryData?.destination ?? null;
  const updatedAt = formatUpdatedAt(isInStore ? vessel?.lastSeenAt ?? vessel?.occurredAt : null);
  const hasOpenSanctionsMatch = sanctionsMatches.some((match) => match.source === 'opensanctions');

  return (
    <div className="w-[280px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
      <div className="border-b border-slate-100 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <VesselIcon
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: vesselIconColor }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold leading-tight text-slate-900">
                {headerTitle}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close vessel details"
            className="-mr-1 shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="border-b border-slate-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className={labelClassName}>Sanctions</span>
          <SanctionsBadge status={sanctionsStatus} />
        </div>
        {sanctionsMatches.length > 0 && <SanctionsMatchList matches={sanctionsMatches} />}
        {hasOpenSanctionsMatch && (
          <div className="mt-2 text-xs italic text-slate-400">
            Data: OpenSanctions (CC BY-NC 4.0)
          </div>
        )}
      </div>

      {!isInStore && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Vessel is outside the current viewport. Live data is unavailable.
        </div>
      )}

      {isInStore && vesselId === null && (
        <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
          Full vessel profile is not available yet.
        </div>
      )}

      <div className="grid grid-cols-2 border-b border-slate-100">
        <DataCell label="MMSI" value={mmsi} className="border-b border-r border-slate-100" />
        <DataCell
          label="IMO"
          value={vessel?.imo ?? queryData?.imo ?? null}
          className="border-b border-slate-100"
        />
        <DataCell
          label="Call sign"
          value={vessel?.callSign ?? queryData?.callSign ?? null}
          className="border-r border-slate-100"
        />
        <DataCell label="Type" value={shipType} />
      </div>

      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="grid grid-cols-[1fr_1fr_1fr_minmax(0,1fr)] items-center gap-2">
          <LiveDataItem
            icon={Gauge}
            value={livePosition ? fmtFixed(livePosition.sog, 1) : '—'}
            unit="kn"
            label="Speed over ground"
          />
          <LiveDataItem
            icon={Compass}
            value={livePosition ? fmtDeg(livePosition.cog) : '—'}
            label="Course over ground"
          />
          <LiveDataItem
            icon={Navigation}
            value={livePosition ? fmtDeg(livePosition.trueHeading) : '—'}
            label="Heading"
          />
          <span
            className="truncate text-xs text-slate-500"
            title={livePosition ? navStatusLabel(livePosition.navStatus) : 'Live nav status'}
          >
            {livePosition ? shortNavStatus(livePosition.navStatus) : '—'}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-1.5 text-slate-600">
          <ArrowRight className="h-3 w-3 shrink-0 text-sky-500" aria-hidden="true" />
          <span className="truncate" title={destination ?? 'Unknown destination'}>
            {destination || 'Unknown destination'}
          </span>
        </div>
        <span className="shrink-0 text-slate-400">Updated {updatedAt}</span>
      </div>

      {vesselId !== null && isLoading && <LoadingHint />}
    </div>
  );
}
