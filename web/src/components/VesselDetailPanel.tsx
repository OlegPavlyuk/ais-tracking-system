import { useQuery } from '@tanstack/react-query';
import { fetchVesselDetail } from '@/api/client';
import { useVesselsStore } from '@/store/vessels';
import { shipTypeLabel } from '@/lib/shipTypeLabel';
import { navStatusLabel } from '@/lib/navStatusLabel';
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
    <li className="text-xs text-gray-700 space-y-0.5">
      <div>
        <span className="font-medium">{match.entityName}</span>
        {' — '}
        {sourceLabel}
        {', '}
        {match.matchMethod}
      </div>
      {match.source === 'opensanctions' && (
        <div className="text-gray-400 italic">Data: OpenSanctions (CC BY-NC 4.0)</div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2 py-1 text-sm border-b border-gray-100 last:border-0">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 text-right">{value ?? '—'}</span>
    </div>
  );
}

export function VesselDetailPanel({ mmsi, vesselId: initialVesselId = null, onClose }: Props) {
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

  // Zustand data takes precedence for sanctions fields (kept live via WS).
  // sanctionsMatches null = enrichment not yet received → fall back to query data.
  // sanctionsMatches [] = enrichment arrived with no matches → authoritative, do not fall back.
  const sanctionsStatus = vessel?.sanctionsStatus ?? queryData?.sanctionsStatus ?? null;
  const sanctionsMatches: VesselDetailRow['sanctionsMatches'] =
    vessel?.sanctionsMatches !== null && vessel?.sanctionsMatches !== undefined
      ? vessel.sanctionsMatches
      : (queryData?.sanctionsMatches ?? []);

  const isInStore = vessel !== undefined;
  const livePosition = vessel
    ? {
        sog: vessel.sog,
        cog: vessel.cog,
        trueHeading: vessel.trueHeading,
        navStatus: vessel.navStatus,
      }
    : queryData?.position ?? null;

  const name = vessel?.name ?? queryData?.name;
  const headerTitle = name ?? `MMSI ${mmsi}`;

  const hasDimensions =
    queryData !== undefined &&
    (queryData.dimensionToBow !== null ||
      queryData.dimensionToStern !== null ||
      queryData.dimensionToPort !== null ||
      queryData.dimensionToStarboard !== null);

  return (
    <div className="fixed right-0 top-0 h-full w-[360px] bg-white shadow-xl z-[200] overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
        <h2 className="text-base font-semibold text-gray-900 leading-tight break-words">
          {headerTitle}
        </h2>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
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

      <div className="flex-1 px-4 py-3 space-y-4">
        {!isInStore && (
          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            Live vessel data is not currently available in the local store.
          </div>
        )}

        {/* mmsi-only fallback (state 2) */}
        {isInStore && vesselId === null && (
          <p className="text-sm text-gray-500">Full vessel profile is not available yet.</p>
        )}

        {/* Identity section */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
            Identity
          </h3>
          <Field label="MMSI" value={mmsi} />
          <Field label="IMO" value={vessel?.imo ?? queryData?.imo ?? null} />
          <Field label="Call sign" value={vessel?.callSign ?? queryData?.callSign ?? null} />
          <Field
            label="Ship type"
            value={shipTypeLabel(vessel?.shipType ?? queryData?.shipType ?? null)}
          />
        </section>

        {/* Sanctions section */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
            Sanctions
          </h3>
          <div className="mb-2">
            <SanctionsPill status={sanctionsStatus} />
          </div>
          {sanctionsMatches.length > 0 && (
            <ul className="space-y-2 mt-1">
              {sanctionsMatches.map((m) => (
                <MatchItem key={m.id} match={m} />
              ))}
            </ul>
          )}
        </section>

        {/* Live position section */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
            Live position
          </h3>
          <Field label="SOG" value={livePosition ? fmt(livePosition.sog, 'kn') : '—'} />
          <Field label="COG" value={livePosition ? fmtDeg(livePosition.cog) : '—'} />
          <Field
            label="Heading"
            value={livePosition ? fmtDeg(livePosition.trueHeading) : '—'}
          />
          <Field
            label="Nav status"
            value={livePosition ? navStatusLabel(livePosition.navStatus) : '—'}
          />
        </section>

        {/* Destination */}
        {(vessel?.destination ?? queryData?.destination) && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Destination
            </h3>
            <p className="text-sm text-gray-900">{vessel?.destination ?? queryData?.destination}</p>
          </section>
        )}

        {/* Dimensions */}
        {hasDimensions && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Dimensions
            </h3>
            <Field label="Bow" value={queryData!.dimensionToBow !== null ? `${queryData!.dimensionToBow} m` : '—'} />
            <Field label="Stern" value={queryData!.dimensionToStern !== null ? `${queryData!.dimensionToStern} m` : '—'} />
            <Field label="Port" value={queryData!.dimensionToPort !== null ? `${queryData!.dimensionToPort} m` : '—'} />
            <Field label="Starboard" value={queryData!.dimensionToStarboard !== null ? `${queryData!.dimensionToStarboard} m` : '—'} />
          </section>
        )}

        {/* Loading state for detail query */}
        {vesselId !== null && isLoading && (
          <p className="text-xs text-gray-400">Loading vessel details...</p>
        )}
      </div>
    </div>
  );
}
