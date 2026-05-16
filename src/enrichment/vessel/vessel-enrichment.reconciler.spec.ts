import { ConfigService } from '../../shared/config/config.service';
import { stubPinoLogger } from '../../shared/testing/metrics-stubs';
import { EnrichmentRepository, VesselFingerprint } from './enrichment.repository';
import { VesselEnrichmentReconciler } from './vessel-enrichment.reconciler';
import { VesselEnrichmentRequester } from './vessel-enrichment.requester';

const vessel = (over: Partial<VesselFingerprint> = {}): VesselFingerprint => ({
  id: '018f7392-15b3-7c4b-9b37-25d6dc2ddf83',
  mmsi: '572469210',
  imo: '9187629',
  name: 'ARTAVIL',
  ...over,
});

const config = (overrides: Partial<Record<Parameters<ConfigService['get']>[0], unknown>> = {}) =>
  (({
    get: jest.fn((key: Parameters<ConfigService['get']>[0]) => {
      const values: Partial<Record<Parameters<ConfigService['get']>[0], unknown>> = {
        ENRICHMENT_STALENESS_SECONDS: 7 * 24 * 60 * 60,
        ENRICHMENT_RECONCILIATION_INTERVAL_MS: 30 * 60 * 1000,
        ENRICHMENT_RECONCILIATION_BATCH_SIZE: 500,
        ...overrides,
      };
      return values[key];
    }),
  }) as unknown) as ConfigService;

const setup = (
  candidates: VesselFingerprint[] | Promise<VesselFingerprint[]> = [vessel()],
  overrides: Partial<Record<Parameters<ConfigService['get']>[0], unknown>> = {},
) => {
  const repo = {
    findVesselsNeedingEnrichment: jest.fn(() => candidates),
  } as unknown as jest.Mocked<Pick<EnrichmentRepository, 'findVesselsNeedingEnrichment'>>;
  const requester = {
    request: jest.fn(async () => ({
      status: 'enqueued' as const,
      trigger: 'stale' as const,
      jobId: 'enrich.v-1.stale.hash',
    })),
  } as unknown as jest.Mocked<Pick<VesselEnrichmentRequester, 'request'>>;
  const reconciler = new VesselEnrichmentReconciler(
    repo as unknown as EnrichmentRepository,
    requester as unknown as VesselEnrichmentRequester,
    config(overrides),
    stubPinoLogger(),
  );
  return { repo, requester, reconciler };
};

describe('VesselEnrichmentReconciler', () => {
  it('scans using configured batch size and staleness cutoff', async () => {
    const now = new Date('2026-05-15T12:00:00.000Z');
    const { repo, requester, reconciler } = setup([vessel()], {
      ENRICHMENT_STALENESS_SECONDS: 60,
      ENRICHMENT_RECONCILIATION_BATCH_SIZE: 42,
    });

    await reconciler.runOnce(now);

    expect(repo.findVesselsNeedingEnrichment).toHaveBeenCalledWith(
      42,
      '2026-05-15T11:59:00.000Z',
    );
    expect(requester.request).toHaveBeenCalledWith({
      vesselId: '018f7392-15b3-7c4b-9b37-25d6dc2ddf83',
      mmsi: '572469210',
      imo: '9187629',
      name: 'ARTAVIL',
    });
  });

  it('continues after per-vessel requester errors', async () => {
    const candidates = [vessel({ id: 'v-1' }), vessel({ id: 'v-2', mmsi: '572469211' })];
    const { requester, reconciler } = setup(candidates);
    requester.request.mockRejectedValueOnce(new Error('queue unavailable'));

    const result = await reconciler.runOnce(new Date('2026-05-15T12:00:00.000Z'));

    expect(requester.request).toHaveBeenCalledTimes(2);
    expect(requester.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ vesselId: 'v-2', mmsi: '572469211' }),
    );
    expect(result).toEqual({ scanned: 2, enqueued: 1, skipped: 0, failed: 1, skippedRun: false });
  });

  it('counts fresh requester skips separately from enqueued jobs', async () => {
    const candidates = [vessel({ id: 'v-1' }), vessel({ id: 'v-2', mmsi: '572469211' })];
    const { requester, reconciler } = setup(candidates);
    requester.request
      .mockResolvedValueOnce({
        status: 'enqueued',
        trigger: 'stale',
        jobId: 'enrich.v-1.stale.hash',
      })
      .mockResolvedValueOnce({ status: 'skipped', reason: 'fresh' });

    const result = await reconciler.runOnce(new Date('2026-05-15T12:00:00.000Z'));

    expect(result).toEqual({ scanned: 2, enqueued: 1, skipped: 1, failed: 0, skippedRun: false });
  });

  it('guards against overlapping runs', async () => {
    let release!: (rows: VesselFingerprint[]) => void;
    const pending = new Promise<VesselFingerprint[]>((resolve) => {
      release = resolve;
    });
    const { repo, reconciler } = setup(pending);

    const first = reconciler.runOnce(new Date('2026-05-15T12:00:00.000Z'));
    const second = await reconciler.runOnce(new Date('2026-05-15T12:00:01.000Z'));
    release([]);
    await first;

    expect(second).toEqual({ scanned: 0, enqueued: 0, skipped: 0, failed: 0, skippedRun: true });
    expect(repo.findVesselsNeedingEnrichment).toHaveBeenCalledTimes(1);
  });

  it('schedules an unrefed interval on module init and clears it on destroy', async () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const { reconciler } = setup([]);

    await reconciler.onModuleInit();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);

    reconciler.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});
