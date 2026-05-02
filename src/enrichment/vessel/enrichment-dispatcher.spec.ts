import { CanonicalEvent } from '../../contracts';
import {
  EnrichmentDispatcher,
  ENRICHMENT_VESSEL_QUEUE,
  EnrichmentJobData,
  profileHashFor,
} from './enrichment-dispatcher';

interface FakeRedis {
  store: Map<string, string>;
  get: jest.Mock<Promise<string | null>, [string]>;
}

const makeRedis = (initial: Record<string, string> = {}): FakeRedis => {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
  };
};

const makeQueue = () => ({
  add: jest.fn(async (_name: string, _data: EnrichmentJobData, _opts?: Record<string, unknown>) => undefined),
});

const makeRepo = (mmsiToVesselId: Record<string, { id: string; imo: string | null; name: string | null }> = {}) => ({
  findVesselFingerprintByMmsi: jest.fn(async (mmsi: string) => mmsiToVesselId[mmsi] ?? null),
});

const positionEvent = (over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  schemaVersion: 1,
  kind: 'position',
  mmsi: '572469210',
  lat: 41,
  lon: 30,
  occurredAt: '2026-05-01T00:00:00Z',
  provider: 'aisstream',
  ingestedAt: '2026-05-01T00:00:01Z',
  ...over,
} as CanonicalEvent);

const staticEvent = (over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  schemaVersion: 1,
  kind: 'static',
  mmsi: '572469210',
  imo: '9187629',
  name: 'ARTAVIL',
  occurredAt: '2026-05-01T00:00:00Z',
  provider: 'aisstream',
  ingestedAt: '2026-05-01T00:00:01Z',
  ...over,
} as CanonicalEvent);

describe('profileHashFor', () => {
  it('is stable for same imo+name', () => {
    expect(profileHashFor({ imo: '9187629', name: 'ARTAVIL' })).toBe(
      profileHashFor({ imo: '9187629', name: 'ARTAVIL' }),
    );
  });

  it('differs when imo or name differs', () => {
    expect(profileHashFor({ imo: '9187629', name: 'ARTAVIL' })).not.toBe(
      profileHashFor({ imo: '9187629', name: 'OTHER' }),
    );
    expect(profileHashFor({ imo: '9187629', name: 'ARTAVIL' })).not.toBe(
      profileHashFor({ imo: '0000000', name: 'ARTAVIL' }),
    );
  });

  it('treats null name and null imo as a stable empty bucket', () => {
    expect(profileHashFor({ imo: null, name: null })).toBe(profileHashFor({ imo: null, name: null }));
  });
});

describe('EnrichmentDispatcher.handle', () => {
  it('skips enqueue when vessel row does not yet exist', async () => {
    const queue = makeQueue();
    const redis = makeRedis();
    const repo = makeRepo({});
    const d = new EnrichmentDispatcher(queue as never, redis as never, repo as never);

    await d.handle(positionEvent());
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips when checked key present and profile hash matches (position event)', async () => {
    const repo = makeRepo({ '572469210': { id: 'v-1', imo: '9187629', name: 'ARTAVIL' } });
    const profileHash = profileHashFor({ imo: '9187629', name: 'ARTAVIL' });
    const redis = makeRedis({
      'enrich:profile:v-1': profileHash,
      'enrich:checked:v-1': '1',
    });
    const queue = makeQueue();
    const d = new EnrichmentDispatcher(queue as never, redis as never, repo as never);

    await d.handle(positionEvent());
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues with trigger "discovered" when no profile key exists', async () => {
    const repo = makeRepo({ '572469210': { id: 'v-1', imo: '9187629', name: 'ARTAVIL' } });
    const redis = makeRedis();
    const queue = makeQueue();
    const d = new EnrichmentDispatcher(queue as never, redis as never, repo as never);

    await d.handle(positionEvent());
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, data, opts] = queue.add.mock.calls[0]!;
    const expectedHash = profileHashFor({ imo: '9187629', name: 'ARTAVIL' });
    expect(data).toMatchObject<Partial<EnrichmentJobData>>({
      vesselId: 'v-1',
      trigger: 'discovered',
      profileHash: expectedHash,
    });
    expect(opts).toMatchObject({ jobId: `enrich.v-1.discovered.${expectedHash}` });
  });

  it('enqueues with trigger "stale" when profile present but checked key expired', async () => {
    const repo = makeRepo({ '572469210': { id: 'v-1', imo: '9187629', name: 'ARTAVIL' } });
    const profileHash = profileHashFor({ imo: '9187629', name: 'ARTAVIL' });
    const redis = makeRedis({ 'enrich:profile:v-1': profileHash });
    const queue = makeQueue();
    const d = new EnrichmentDispatcher(queue as never, redis as never, repo as never);

    await d.handle(positionEvent());
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, data, opts] = queue.add.mock.calls[0]!;
    expect(data).toMatchObject({ vesselId: 'v-1', trigger: 'stale' });
    expect(opts).toMatchObject({ jobId: `enrich.v-1.stale.${profileHash}` });
  });

  it('enqueues with trigger "profile_changed" when static event carries new imo/name', async () => {
    const repo = makeRepo({ '572469210': { id: 'v-1', imo: '0000000', name: 'OLD' } });
    const oldHash = profileHashFor({ imo: '0000000', name: 'OLD' });
    const redis = makeRedis({
      'enrich:profile:v-1': oldHash,
      'enrich:checked:v-1': '1',
    });
    const queue = makeQueue();
    const d = new EnrichmentDispatcher(queue as never, redis as never, repo as never);

    await d.handle(staticEvent({ imo: '9187629', name: 'ARTAVIL' } as Partial<CanonicalEvent>));
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, data] = queue.add.mock.calls[0]!;
    const newHash = profileHashFor({ imo: '9187629', name: 'ARTAVIL' });
    expect(data).toMatchObject({ vesselId: 'v-1', trigger: 'profile_changed', profileHash: newHash });
  });

  it('skips when static event arrives with unchanged profile and checked key present', async () => {
    const repo = makeRepo({ '572469210': { id: 'v-1', imo: '9187629', name: 'ARTAVIL' } });
    const hash = profileHashFor({ imo: '9187629', name: 'ARTAVIL' });
    const redis = makeRedis({
      'enrich:profile:v-1': hash,
      'enrich:checked:v-1': '1',
    });
    const queue = makeQueue();
    const d = new EnrichmentDispatcher(queue as never, redis as never, repo as never);

    await d.handle(staticEvent());
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('routes to the enrichment.vessel queue', () => {
    expect(ENRICHMENT_VESSEL_QUEUE).toBe('enrichment.vessel');
  });
});
