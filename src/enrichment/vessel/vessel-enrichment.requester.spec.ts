import { VesselPersistedEvent } from '../../contracts';
import { stubPinoLogger } from '../../shared/testing/metrics-stubs';
import { EnrichmentJobData } from './enrichment.types';
import {
  VesselEnrichmentRequester,
  checkedKey,
  profileHashFor,
  profileKey,
} from './vessel-enrichment.requester';

interface FakeRedis {
  get: jest.Mock<Promise<string | null>, [string]>;
}

const makeRedis = (initial: Record<string, string> = {}): FakeRedis => {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
  };
};

const makeQueue = () => ({
  add: jest.fn(async (_name: string, _data: EnrichmentJobData, _opts?: Record<string, unknown>) => undefined),
});

const setup = (redisState: Record<string, string> = {}) => {
  const redis = makeRedis(redisState);
  const queue = makeQueue();
  const requester = new VesselEnrichmentRequester(queue as never, redis as never, stubPinoLogger());

  return { redis, queue, requester };
};

const persistedEvent = (over: Partial<VesselPersistedEvent> = {}): VesselPersistedEvent => ({
  schemaVersion: 1,
  kind: 'vessel.persisted',
  vesselId: '018f7392-15b3-7c4b-9b37-25d6dc2ddf83',
  mmsi: '572469210',
  imo: '9187629',
  name: 'ARTAVIL',
  sourceEventKind: 'position',
  persistedAt: '2026-05-01T00:00:01.000Z',
  ...over,
});

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

  it('normalizes equivalent names before hashing', () => {
    expect(profileHashFor({ imo: '9187629', name: 'ARTAVIL' })).toBe(
      profileHashFor({ imo: '9187629', name: ' artavil ' }),
    );
  });
});

describe('VesselEnrichmentRequester.request', () => {
  it('enqueues discovered when no Redis profile key exists', async () => {
    const event = persistedEvent({ traceId: '018f7392-15b3-7c4b-9b37-25d6dc2ddf84' });
    const { queue, requester } = setup();

    const result = await requester.request(event);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data] = queue.add.mock.calls[0]!;
    expect(name).toBe('enrich');
    expect(data).toMatchObject<Partial<EnrichmentJobData>>({
      vesselId: event.vesselId,
      mmsi: event.mmsi,
      trigger: 'discovered',
      profileHash: profileHashFor({ imo: event.imo, name: event.name }),
      observedImo: event.imo,
      observedName: event.name,
      traceId: event.traceId,
    });
    const expectedHash = profileHashFor({ imo: event.imo, name: event.name });
    expect(result).toEqual({
      status: 'enqueued',
      trigger: 'discovered',
      jobId: `enrich.${event.vesselId}.discovered.${expectedHash}`,
    });
  });

  it('enqueues profile_changed when profile hash changed', async () => {
    const event = persistedEvent({ imo: '9187629', name: 'ARTAVIL' });
    const { queue, requester } = setup({
      [profileKey(event.vesselId)]: profileHashFor({ imo: '0000000', name: 'OLD' }),
      [checkedKey(event.vesselId)]: '1',
    });

    const result = await requester.request(event);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, data] = queue.add.mock.calls[0]!;
    expect(data).toMatchObject({
      vesselId: event.vesselId,
      trigger: 'profile_changed',
      profileHash: profileHashFor({ imo: event.imo, name: event.name }),
    });
    expect(result).toEqual({
      status: 'enqueued',
      trigger: 'profile_changed',
      jobId: `enrich.${event.vesselId}.profile_changed.${profileHashFor({ imo: event.imo, name: event.name })}`,
    });
  });

  it('enqueues stale when checked key is missing', async () => {
    const event = persistedEvent();
    const profileHash = profileHashFor({ imo: event.imo, name: event.name });
    const { queue, requester } = setup({ [profileKey(event.vesselId)]: profileHash });

    const result = await requester.request(event);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, data] = queue.add.mock.calls[0]!;
    expect(data).toMatchObject({ vesselId: event.vesselId, trigger: 'stale' });
    expect(result).toEqual({
      status: 'enqueued',
      trigger: 'stale',
      jobId: `enrich.${event.vesselId}.stale.${profileHash}`,
    });
  });

  it('skips when profile hash matches and checked key exists', async () => {
    const event = persistedEvent();
    const profileHash = profileHashFor({ imo: event.imo, name: event.name });
    const { queue, requester } = setup({
      [profileKey(event.vesselId)]: profileHash,
      [checkedKey(event.vesselId)]: '1',
    });

    const result = await requester.request(event);

    expect(queue.add).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'skipped', reason: 'fresh' });
  });

  it('uses deterministic job ID', async () => {
    const event = persistedEvent();
    const { queue, requester } = setup();

    await requester.request(event);

    const expectedHash = profileHashFor({ imo: event.imo, name: event.name });
    const [, , opts] = queue.add.mock.calls[0]!;
    expect(opts).toMatchObject({
      jobId: `enrich.${event.vesselId}.discovered.${expectedHash}`,
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  });

  it('uses the same deterministic job ID for duplicate persisted events with the same profile', async () => {
    const event = persistedEvent();
    const { queue, requester } = setup();

    const first = await requester.request(event);
    const second = await requester.request(event);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(first).toEqual(second);
    expect(queue.add.mock.calls[0]![2]?.jobId).toBe(queue.add.mock.calls[1]![2]?.jobId);
  });

  it('passes expected EnrichmentJobData', async () => {
    const event = persistedEvent({ imo: null, name: 'ARTAVIL' });
    const { queue, requester } = setup();

    await requester.request(event);

    const [, data] = queue.add.mock.calls[0]!;
    expect(data).toEqual<EnrichmentJobData>({
      vesselId: event.vesselId,
      mmsi: event.mmsi,
      trigger: 'discovered',
      profileHash: profileHashFor({ imo: event.imo, name: event.name }),
      observedImo: event.imo,
      observedName: event.name,
      traceId: undefined,
    });
  });
});
