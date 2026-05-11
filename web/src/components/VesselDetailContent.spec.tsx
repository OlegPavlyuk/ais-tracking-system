import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VesselDetailContent } from './VesselDetailContent';
import { useVesselsStore } from '@/store/vessels';
import type { Vessel, VesselDetailRow, VesselSanctionMatch } from '@/store/types';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
}

function renderContent(mmsi: string, qc = makeQueryClient(), vesselId?: string | null) {
  return render(
    <QueryClientProvider client={qc}>
      <VesselDetailContent
        mmsi={mmsi}
        {...(vesselId === undefined ? {} : { vesselId })}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const BASE_VESSEL: Vessel = {
  mmsi: '123456789',
  vesselId: null,
  lastSeenAt: '2024-01-01T00:00:00.000Z',
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

function seedVessel(overrides: Partial<Vessel> = {}) {
  const vessel: Vessel = { ...BASE_VESSEL, ...overrides };
  useVesselsStore.setState({ vessels: new Map([[vessel.mmsi, vessel]]) });
  return vessel;
}

beforeEach(() => {
  useVesselsStore.setState({ vessels: new Map(), wsStatus: 'idle', error: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VesselDetailContent', () => {
  it('renders mmsi-only fallback when vesselId is null', () => {
    seedVessel({ vesselId: null });
    renderContent('123456789');
    expect(screen.getByText('Full vessel profile is not available yet.')).toBeInTheDocument();
  });

  it('renders profile data from query response', async () => {
    seedVessel({ vesselId: 'vessel-id-1' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(DETAIL_RESPONSE), { status: 200 }),
    );

    renderContent('123456789');

    await waitFor(() => {
      expect(screen.getByText('PORT X')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Cargo').length).toBeGreaterThanOrEqual(1);
  });

  it('omits the dimensions section', async () => {
    seedVessel({ vesselId: 'vessel-id-1' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(DETAIL_RESPONSE), { status: 200 }),
    );

    renderContent('123456789');

    await waitFor(() => {
      expect(screen.getByText('PORT X')).toBeInTheDocument();
    });
    expect(screen.queryByText('Dimensions')).not.toBeInTheDocument();
    expect(screen.queryByText('Bow')).not.toBeInTheDocument();
  });

  it('renders Unchecked pill for null sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: null });
    renderContent('123456789');
    expect(screen.getByText('Unchecked')).toBeInTheDocument();
  });

  it('renders No match pill for clear sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: 'clear' });
    renderContent('123456789');
    expect(screen.getByText('No match')).toBeInTheDocument();
  });

  it('renders Candidate match pill for candidate sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: 'candidate' });
    renderContent('123456789');
    expect(screen.getByText('Candidate match')).toBeInTheDocument();
  });

  it('renders Sanctioned match pill for sanctioned sanctionsStatus', () => {
    seedVessel({ vesselId: null, sanctionsStatus: 'sanctioned' });
    renderContent('123456789');
    expect(screen.getByText('Sanctioned match')).toBeInTheDocument();
  });

  it('calls onClose from the close button', () => {
    seedVessel({ vesselId: null });
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <VesselDetailContent mmsi="123456789" onClose={onClose} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close vessel details' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders match list when sanctionsMatches are present', async () => {
    seedVessel({ vesselId: 'vessel-id-1' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
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
        } satisfies VesselDetailRow),
        { status: 200 },
      ),
    );

    renderContent('123456789');

    await waitFor(() => {
      expect(screen.getByText(/ACME CORP/)).toBeInTheDocument();
    });
    expect(screen.getByText(/OFAC/)).toBeInTheDocument();
  });

  it('shows a single OpenSanctions attribution when relevant', async () => {
    seedVessel({ vesselId: 'vessel-id-1' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
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
        } satisfies VesselDetailRow),
        { status: 200 },
      ),
    );

    renderContent('123456789');

    await waitFor(() => {
      expect(screen.getByText(/OS ENTITY/)).toBeInTheDocument();
    });
    expect(screen.getByText(/OpenSanctions \(CC BY-NC 4\.0\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/OpenSanctions \(CC BY-NC 4\.0\)/)).toHaveLength(1);
  });

  it('shows outside-viewport fallback when vessel is absent from Zustand', () => {
    renderContent('123456789');
    expect(
      screen.getByText('Vessel is outside the current viewport. Live data is unavailable.'),
    ).toBeInTheDocument();
  });

  it('suppresses live position fields when vessel is absent from Zustand', () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(DETAIL_RESPONSE), { status: 200 }),
    );
    renderContent('123456789', makeQueryClient(), 'vessel-id-1');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('12.5 kn')).not.toBeInTheDocument();
    expect(screen.queryByText('90°')).not.toBeInTheDocument();
  });

  it('suppresses live position fields when vessel lacks live coordinates', () => {
    seedVessel({ lat: null, lon: null });
    renderContent('123456789');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
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
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...DETAIL_RESPONSE,
          sanctionsMatches: [
            {
              id: 'query-match',
              source: 'opensanctions',
              entityName: 'QUERY ENTITY',
              matchMethod: 'mmsi',
              score: null,
            },
          ],
        } satisfies VesselDetailRow),
        { status: 200 },
      ),
    );

    renderContent('123456789');

    await waitFor(() => {
      expect(screen.getByText(/LIVE ENTITY/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/QUERY ENTITY/)).not.toBeInTheDocument();
  });

  it('updates sanctions pill live from Zustand after render', async () => {
    seedVessel({ vesselId: 'vessel-id-1', sanctionsStatus: null, sanctionsMatches: null });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(DETAIL_RESPONSE), { status: 200 }),
    );

    renderContent('123456789');

    await waitFor(() => {
      expect(screen.getByText('No match')).toBeInTheDocument();
    });

    await act(async () => {
      useVesselsStore.setState((state) => {
        const next = new Map(state.vessels);
        next.set('123456789', {
          ...state.vessels.get('123456789')!,
          sanctionsStatus: 'sanctioned',
          sanctionsMatches: [
            {
              id: 'live',
              source: 'ofac',
              entityName: 'LIVE SANCTION',
              matchMethod: 'imo',
              score: null,
            },
          ],
        });
        return { vessels: next };
      });
      await Promise.resolve();
    });

    expect(screen.getByText('Sanctioned match')).toBeInTheDocument();
    expect(screen.getByText('LIVE SANCTION')).toBeInTheDocument();
  });
});
