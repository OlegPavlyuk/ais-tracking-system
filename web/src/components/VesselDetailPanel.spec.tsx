import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VesselDetailPanel } from './VesselDetailPanel';
import { useVesselsStore } from '@/store/vessels';
import type { Vessel, VesselDetailRow, VesselSanctionMatch } from '@/store/types';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
}

function renderPanel(mmsi: string, qc = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <VesselDetailPanel mmsi={mmsi} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const BASE_VESSEL: Vessel = {
  mmsi: '123456789',
  vesselId: null,
  lat: 43.0,
  lon: 30.0,
  sog: 12.5,
  cog: 90,
  trueHeading: 91,
  navStatus: 0,
  occurredAt: '2024-01-01T00:00:00.000Z',
  imo: '9999999',
  name: 'TEST VESSEL',
  callSign: 'TCALL',
  shipType: 70,
  destination: null,
  staticOccurredAt: null,
  sanctionsStatus: null,
  sanctionsCheckedAt: null,
  sanctionsMatches: null,
};

const DETAIL_RESPONSE: VesselDetailRow = {
  id: 'vessel-id-1',
  mmsi: '123456789',
  imo: '9999999',
  name: 'TEST VESSEL',
  callSign: 'TCALL',
  shipType: 70,
  destination: 'PORT X',
  dimensionToBow: 100,
  dimensionToStern: 20,
  dimensionToPort: 10,
  dimensionToStarboard: 10,
  sanctionsStatus: 'clear',
  sanctionsCheckedAt: '2024-01-01T00:00:00.000Z',
  sanctionsMatches: [],
  position: {
    lat: 43.0,
    lon: 30.0,
    sog: 12.5,
    cog: 90,
    trueHeading: 91,
    navStatus: 0,
    occurredAt: '2024-01-01T00:00:00.000Z',
  },
};

beforeEach(() => {
  useVesselsStore.setState({ vessels: new Map(), bbox: null, wsStatus: 'idle', error: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedVessel(overrides: Partial<Vessel> = {}) {
  const vessel: Vessel = { ...BASE_VESSEL, ...overrides };
  useVesselsStore.setState({ vessels: new Map([[vessel.mmsi, vessel]]) });
  return vessel;
}

describe('VesselDetailPanel', () => {
  it('renders mmsi-only fallback when vesselId is null (state 2)', () => {
    seedVessel({ vesselId: null });
    renderPanel('123456789');
    expect(screen.getByText('Full vessel profile is not available yet.')).toBeInTheDocument();
  });

  it('renders profile data from query response (state 1)', async () => {
    seedVessel({ vesselId: 'vessel-id-1' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(DETAIL_RESPONSE), { status: 200 }),
    );

    renderPanel('123456789');

    await waitFor(() => {
      expect(screen.getByText('PORT X')).toBeInTheDocument();
    });
    expect(screen.getByText('Cargo')).toBeInTheDocument();
  });

  it('renders "Unchecked" pill for null sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: null });
    renderPanel('123456789');
    expect(screen.getByText('Unchecked')).toBeInTheDocument();
  });

  it('renders "No match" pill for clear sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: 'clear' });
    renderPanel('123456789');
    expect(screen.getByText('No match')).toBeInTheDocument();
  });

  it('renders "Candidate match" pill for candidate sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: 'candidate' });
    renderPanel('123456789');
    expect(screen.getByText('Candidate match')).toBeInTheDocument();
  });

  it('renders "Sanctioned match" pill for sanctioned sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: 'sanctioned' });
    renderPanel('123456789');
    expect(screen.getByText('Sanctioned match')).toBeInTheDocument();
  });

  it('renders match list when sanctionsMatches are present', async () => {
    seedVessel({ vesselId: 'vessel-id-1' });
    const detailWithMatches: VesselDetailRow = {
      ...DETAIL_RESPONSE,
      sanctionsMatches: [
        {
          id: 'm1',
          source: 'ofac',
          entityName: 'ACME CORP',
          matchMethod: 'IMO',
          score: 0.9,
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(detailWithMatches), { status: 200 }),
    );

    renderPanel('123456789');

    await waitFor(() => {
      expect(screen.getByText(/ACME CORP/)).toBeInTheDocument();
    });
    expect(screen.getByText(/OFAC/)).toBeInTheDocument();
  });

  it('shows OpenSanctions attribution for opensanctions source but not for ofac', async () => {
    seedVessel({ vesselId: 'vessel-id-1' });
    const detailWithBoth: VesselDetailRow = {
      ...DETAIL_RESPONSE,
      sanctionsMatches: [
        {
          id: 'm1',
          source: 'ofac',
          entityName: 'OFAC ENTITY',
          matchMethod: 'IMO',
          score: 0.9,
        },
        {
          id: 'm2',
          source: 'opensanctions',
          entityName: 'OS ENTITY',
          matchMethod: 'Name candidate',
          score: 0.7,
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(detailWithBoth), { status: 200 }),
    );

    renderPanel('123456789');

    await waitFor(() => {
      expect(screen.getByText(/OS ENTITY/)).toBeInTheDocument();
    });
    expect(screen.getByText(/OpenSanctions \(CC BY-NC 4\.0\)/)).toBeInTheDocument();
    // OFAC match should not have an attribution line
    const attributionNodes = screen.getAllByText(/OpenSanctions \(CC BY-NC 4\.0\)/);
    expect(attributionNodes).toHaveLength(1);
  });

  it('shows outside viewport indicator when vessel is absent from Zustand (state 3)', () => {
    // No vessel seeded — store is empty
    renderPanel('123456789');
    expect(screen.getByText('Vessel is outside the current viewport.')).toBeInTheDocument();
  });

  it('shows — for live position fields in state 3', () => {
    // No vessel in store
    renderPanel('123456789');
    const dashes = screen.getAllByText('—');
    // SOG, COG, Heading, Nav status should all be —
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it('prefers Zustand sanctionsMatches over query matches when Zustand has non-null matches', async () => {
    const zustandMatch: VesselSanctionMatch = {
      id: 'live-match',
      source: 'ofac',
      entityName: 'LIVE ENTITY',
      matchMethod: 'imo',
      score: null,
    };
    seedVessel({ vesselId: 'vessel-id-1', sanctionsMatches: [zustandMatch] });
    const detailWithDifferentMatch: VesselDetailRow = {
      ...DETAIL_RESPONSE,
      sanctionsMatches: [
        { id: 'query-match', source: 'opensanctions', entityName: 'QUERY ENTITY', matchMethod: 'mmsi', score: null },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(detailWithDifferentMatch), { status: 200 }),
    );

    renderPanel('123456789');

    await waitFor(() => {
      expect(screen.getByText(/LIVE ENTITY/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/QUERY ENTITY/)).not.toBeInTheDocument();
  });

  it('falls back to query sanctionsMatches when Zustand sanctionsMatches is null', async () => {
    seedVessel({ vesselId: 'vessel-id-1', sanctionsMatches: null });
    const detailWithMatch: VesselDetailRow = {
      ...DETAIL_RESPONSE,
      sanctionsMatches: [
        { id: 'q1', source: 'opensanctions', entityName: 'FALLBACK ENTITY', matchMethod: 'name_candidate', score: null },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(detailWithMatch), { status: 200 }),
    );

    renderPanel('123456789');

    await waitFor(() => {
      expect(screen.getByText(/FALLBACK ENTITY/)).toBeInTheDocument();
    });
  });

  it('does not fall back to query matches when Zustand sanctionsMatches is empty array', async () => {
    // Empty array = enrichment arrived with zero matches; authoritative — do not fall back.
    seedVessel({ vesselId: 'vessel-id-1', sanctionsMatches: [] });
    const detailWithMatch: VesselDetailRow = {
      ...DETAIL_RESPONSE,
      sanctionsMatches: [
        { id: 'q1', source: 'ofac', entityName: 'SHOULD NOT APPEAR', matchMethod: 'imo', score: null },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(detailWithMatch), { status: 200 }),
    );

    renderPanel('123456789');

    // Give the query time to resolve, then assert the query match is absent.
    await waitFor(() => {
      expect(screen.queryByText(/SHOULD NOT APPEAR/)).not.toBeInTheDocument();
    });
  });
});
