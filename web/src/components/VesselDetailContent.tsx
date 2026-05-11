import { useQuery } from '@tanstack/react-query';
import { fetchVesselDetail } from '@/api/client';
import { navStatusLabel } from '@/lib/navStatusLabel';
import { relativeTime } from '@/lib/relativeTime';
import { shipTypeLabel } from '@/lib/shipTypeLabel';
import { useVesselsStore } from '@/store/vessels';
import type { VesselDetailRow, VesselSanctionMatch } from '@/store/types';

interface Props {
  mmsi: string;
  vesselId?: string | null;
  onClose: () => void;
}

function fmt(value: number | null, suffix: string): string {
  return value !== null ? `${value} ${suffix}` : '—';
}

function fmtDeg(value: number | null): string {
  return value !== null ? `${value}°` : '—';
}

function formatUpdatedAt(value: string | null | undefined): string {
  return relativeTime(value ?? null);
}

const SANCTIONS_LABELS: Record<string, string> = {
  clear: 'No match',
  candidate: 'Candidate match',
  sanctioned: 'Sanctioned match',
};

const SANCTIONS_STYLES: Record<string, string> = {
  clear: 'bg-green-100 text-green-800',
  candidate: 'bg-yellow-100 text-yellow-800',
  sanctioned: 'bg-red-100 text-red-800',
};

function SanctionsPill({ status }: { status: 'clear' | 'candidate' | 'sanctioned' | null }) {
  if (status === null) {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
        Unchecked
      </span>
    );
  }
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${SANCTIONS_STYLES[status] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {SANCTIONS_LABELS[status] ?? status}
    </span>
  );
}

function MatchItem({ match }: { match: VesselSanctionMatch }) {
  const sourceLabel = match.source === 'ofac' ? 'OFAC' : 'OpenSanctions';
  return (
    <li className="text-xs text-gray-700">
      <span className="font-medium">{match.entityName}</span>
      {' — '}
      {sourceLabel}
      {', '}
      {match.matchMethod}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm border-b border-gray-100 last:border-0">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 text-right">{value ?? '—'}</span>
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
  const shipType = shipTypeLabel(vessel?.shipType ?? queryData?.shipType ?? null);
  const destination = vessel?.destination ?? queryData?.destination ?? null;
  const updatedAt = formatUpdatedAt(isInStore ? vessel?.lastSeenAt ?? vessel?.occurredAt : null);
  const hasOpenSanctionsMatch = sanctionsMatches.some((match) => match.source === 'opensanctions');

  return (
    <div className="w-[320px] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 break-words">{headerTitle}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{shipType}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close vessel details"
          className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {!isInStore && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Vessel is outside the current viewport. Live data is unavailable.
          </div>
        )}

        {isInStore && vesselId === null && (
          <p className="text-sm text-gray-500">Full vessel profile is not available yet.</p>
        )}

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Identity
          </h3>
          <Field label="MMSI" value={mmsi} />
          <Field label="IMO" value={vessel?.imo ?? queryData?.imo ?? null} />
          <Field label="Call sign" value={vessel?.callSign ?? queryData?.callSign ?? null} />
          <Field label="Ship type" value={shipType} />
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Sanctions
          </h3>
          <div className="mb-2">
            <SanctionsPill status={sanctionsStatus} />
          </div>
          {sanctionsMatches.length > 0 && (
            <ul className="space-y-1.5">
              {sanctionsMatches.map((match) => (
                <MatchItem key={match.id} match={match} />
              ))}
            </ul>
          )}
          {hasOpenSanctionsMatch && (
            <div className="mt-2 text-xs italic text-gray-400">
              Data: OpenSanctions (CC BY-NC 4.0)
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Live position
          </h3>
          <Field label="SOG" value={livePosition ? fmt(livePosition.sog, 'kn') : '—'} />
          <Field label="COG" value={livePosition ? fmtDeg(livePosition.cog) : '—'} />
          <Field label="Heading" value={livePosition ? fmtDeg(livePosition.trueHeading) : '—'} />
          <Field
            label="Nav status"
            value={livePosition ? navStatusLabel(livePosition.navStatus) : '—'}
          />
        </section>

        {destination && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Destination
            </h3>
            <p className="text-sm text-gray-900">{destination}</p>
          </section>
        )}

        <div className="border-t border-gray-100 pt-2 text-xs text-gray-400">
          Updated {updatedAt}
        </div>

        {vesselId !== null && isLoading && (
          <p className="text-xs text-gray-400">Loading vessel details...</p>
        )}
      </div>
    </div>
  );
}
