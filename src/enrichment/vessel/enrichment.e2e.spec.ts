import { Job } from 'bullmq';
import { VesselPersistedEvent } from '../../contracts';
import { EnrichmentJobData } from './enrichment.types';
import { EnrichmentProcessor } from './enrichment.processor';
import { EnrichmentRepository, VesselFingerprint } from './enrichment.repository';
import { SanctionCandidate } from './matcher';
import {
  VesselEnrichmentRequester,
  checkedKey,
  profileHashFor,
  profileKey,
} from './vessel-enrichment.requester';
import { VESSEL_ENRICHED_STREAM } from '../../shared/config/constants';
import { ConfigService } from '../../shared/config/config.service';
import { EventBus } from '../../shared/bus/event-bus';
import { stubCounter, stubPinoLogger } from '../../shared/testing/metrics-stubs';

const STALENESS_SECONDS = 604800;

interface MockRepo {
  findVesselFingerprintByMmsi: jest.Mock;
  findSanctionCandidatesByImo: jest.Mock;
  findSanctionCandidatesByMmsi: jest.Mock;
  findSanctionCandidatesByName: jest.Mock;
  applyEnrichment: jest.Mock;
}

const makeRedis = (initial: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(initial));
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK' as const;
    }),
    expire: jest.fn(async () => 1),
  };

  return { redis, store };
};

const makeBus = () => {
  const published: { stream: string; payload: unknown }[] = [];
  const bus: EventBus = {
    publish: jest.fn(async (stream: string, payload: unknown) => {
      published.push({ stream, payload });
      return '1-0';
    }),
    subscribe: jest.fn(async () => undefined),
  };

  return { bus, published };
};

const makeConfig = (stalenessSeconds = STALENESS_SECONDS) =>
  ({
    get: jest.fn((key: string) =>
      key === 'ENRICHMENT_STALENESS_SECONDS' ? stalenessSeconds : undefined,
    ),
  }) as unknown as ConfigService;

const makeRepo = (overrides: Partial<MockRepo> = {}): MockRepo => ({
    findVesselFingerprintByMmsi: jest.fn(async () => null),
    findSanctionCandidatesByImo: jest.fn(async () => []),
    findSanctionCandidatesByMmsi: jest.fn(async () => []),
    findSanctionCandidatesByName: jest.fn(async () => []),
    applyEnrichment: jest.fn(async () => 1),
    ...overrides,
  });

const makeProcessor = ({
  repo,
  redis = makeRedis().redis,
  bus = makeBus().bus,
  config = makeConfig(),
}: {
  repo: MockRepo;
  redis?: ReturnType<typeof makeRedis>['redis'];
  bus?: EventBus;
  config?: ConfigService;
}) =>
  new EnrichmentProcessor(
    repo as unknown as EnrichmentRepository,
    bus,
    redis as never,
    config,
    stubCounter(),
    stubCounter(),
    stubPinoLogger(),
  );

const makeQueue = () => {
  const calls: { name: string; data: EnrichmentJobData; opts?: Record<string, unknown> }[] = [];
  const queue = {
    add: jest.fn(async (name: string, data: EnrichmentJobData, opts?: Record<string, unknown>) => {
      calls.push({ name, data, opts });
      return undefined;
    }),
  };

  return { queue, calls };
};

describe('enrichment loop (persisted event requester + processor)', () => {
  it('discovers vessel → enqueues job → matcher fires on IMO → publishes vessel.enriched and sets cache keys', async () => {
    const vessel: VesselFingerprint = {
      id: 'v-1',
      mmsi: '572469210',
      imo: '9187629',
      name: 'ARTAVIL',
    };
    const sanctioned: SanctionCandidate = {
      entityId: 'e-1',
      source: 'ofac',
      sourceEntityId: '15036',
      name: 'ARTAVIL',
      imo: '9187629',
      mmsi: null,
      aliases: ['ABADAN'],
      flag: 'Iran',
      listingDate: null,
      programs: ['IRAN'],
    };

    const repo = makeRepo({
      findVesselFingerprintByMmsi: jest.fn(async (mmsi: string) =>
        mmsi === vessel.mmsi ? vessel : null,
      ),
      findSanctionCandidatesByImo: jest.fn(async () => [sanctioned]),
      findSanctionCandidatesByMmsi: jest.fn(async () => []),
      findSanctionCandidatesByName: jest.fn(async () => []),
      applyEnrichment: jest.fn(async () => 1),
    });

    const { redis, store: redisStore } = makeRedis();
    const { queue, calls: queueCalls } = makeQueue();

    const requester = new VesselEnrichmentRequester(
      queue as never,
      redis as never,
      stubPinoLogger(),
    );

    const persistedEvent: VesselPersistedEvent = {
      schemaVersion: 1,
      kind: 'vessel.persisted',
      vesselId: vessel.id,
      mmsi: vessel.mmsi,
      imo: vessel.imo,
      name: vessel.name,
      sourceEventKind: 'position',
      persistedAt: '2026-05-02T00:00:00.500Z',
    };

    await requester.request(persistedEvent);

    expect(queueCalls).toHaveLength(1);
    const enq = queueCalls[0]!;
    expect(enq.data).toMatchObject({
      vesselId: 'v-1',
      mmsi: vessel.mmsi,
      trigger: 'discovered',
      profileHash: profileHashFor({ imo: '9187629', name: 'ARTAVIL' }),
    });

    const { bus, published } = makeBus();
    const processor = makeProcessor({ repo, redis, bus });
    const job = { id: 'job-1', data: enq.data } as unknown as Job<EnrichmentJobData>;
    const result = await processor.process(job);

    expect(result).toEqual({ status: 'sanctioned', matches: 1 });
    expect(repo.findSanctionCandidatesByImo).toHaveBeenCalledWith('9187629');
    expect(repo.findSanctionCandidatesByMmsi).toHaveBeenCalledWith('572469210');
    expect(repo.findSanctionCandidatesByName).not.toHaveBeenCalled();
    expect(repo.applyEnrichment).toHaveBeenCalledTimes(1);
    expect((repo.applyEnrichment as jest.Mock).mock.calls[0]![0]).toMatchObject({
      vesselId: 'v-1',
      status: 'sanctioned',
    });
    expect(typeof (repo.applyEnrichment as jest.Mock).mock.calls[0]![0].checkedAt).toBe('string');

    expect(published).toHaveLength(1);
    expect(published[0]!.stream).toBe(VESSEL_ENRICHED_STREAM);
    expect(published[0]!.payload).toMatchObject({
      vesselId: 'v-1',
      mmsi: vessel.mmsi,
      status: 'sanctioned',
      matches: [
        expect.objectContaining({
          source: 'ofac',
          sourceEntityId: '15036',
          matchMethod: 'imo',
          flag: 'Iran',
          programs: ['IRAN'],
        }),
      ],
    });

    expect(redisStore.get(profileKey(vessel.id))).toBe(profileHashFor({ imo: '9187629', name: 'ARTAVIL' }));
    const checkedAt = (repo.applyEnrichment.mock.calls[0]![0] as { checkedAt: string }).checkedAt;
    expect(redisStore.get(checkedKey(vessel.id))).toBe(checkedAt);
    expect(redis.set).toHaveBeenCalledWith(checkedKey(vessel.id), checkedAt, 'EX', STALENESS_SECONDS);
  });

  it('skips publishing when timestamp guard rejects the update', async () => {
    const vessel: VesselFingerprint = {
      id: 'v-2',
      mmsi: '572438210',
      imo: null,
      name: 'OTHER',
    };
    const repo = makeRepo({
      findVesselFingerprintByMmsi: jest.fn(async () => vessel),
      findSanctionCandidatesByImo: jest.fn(async () => []),
      findSanctionCandidatesByMmsi: jest.fn(async () => []),
      findSanctionCandidatesByName: jest.fn(async () => []),
      applyEnrichment: jest.fn(async () => 0),
    });
    const { bus } = makeBus();
    const { redis } = makeRedis();
    const processor = makeProcessor({ repo, bus, redis });
    const data: EnrichmentJobData = {
      vesselId: 'v-2',
      mmsi: vessel.mmsi,
      trigger: 'stale',
      profileHash: 'abc',
      observedImo: null,
      observedName: 'OTHER',
    };
    const result = await processor.process({ id: 'j', data } as unknown as Job<EnrichmentJobData>);
    expect(result).toEqual({ status: 'noop', matches: 0 });
    expect(bus.publish).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to name lookup when identifiers do not match', async () => {
    const vessel: VesselFingerprint = {
      id: 'v-3',
      mmsi: '572469211',
      imo: '9187630',
      name: 'ARTAVIL',
    };
    const sanctioned: SanctionCandidate = {
      entityId: 'e-2',
      source: 'ofac',
      sourceEntityId: '15037',
      name: 'ARTAVIL',
      imo: null,
      mmsi: null,
      aliases: [],
      flag: 'Iran',
      listingDate: null,
      programs: ['IRAN'],
    };
    const repo = makeRepo({
      findVesselFingerprintByMmsi: jest.fn(async () => vessel),
      findSanctionCandidatesByImo: jest.fn(async () => []),
      findSanctionCandidatesByMmsi: jest.fn(async () => []),
      findSanctionCandidatesByName: jest.fn(async () => [sanctioned]),
      applyEnrichment: jest.fn(async () => 1),
    });
    const processor = makeProcessor({ repo });

    const result = await processor.process({
      id: 'j',
      data: {
        vesselId: vessel.id,
        mmsi: vessel.mmsi,
        trigger: 'profile_changed',
        profileHash: 'abc',
        observedImo: vessel.imo,
        observedName: vessel.name,
      },
    } as unknown as Job<EnrichmentJobData>);

    expect(result).toEqual({ status: 'candidate', matches: 1 });
    expect(repo.findSanctionCandidatesByImo).toHaveBeenCalledWith('9187630');
    expect(repo.findSanctionCandidatesByMmsi).toHaveBeenCalledWith('572469211');
    expect(repo.findSanctionCandidatesByImo.mock.invocationCallOrder[0]).toBeLessThan(
      repo.findSanctionCandidatesByName.mock.invocationCallOrder[0]!,
    );
    expect(repo.findSanctionCandidatesByMmsi.mock.invocationCallOrder[0]).toBeLessThan(
      repo.findSanctionCandidatesByName.mock.invocationCallOrder[0]!,
    );
    expect(repo.findSanctionCandidatesByName).toHaveBeenCalledWith('ARTAVIL');
    expect(repo.applyEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({
        vesselId: 'v-3',
        status: 'candidate',
        matches: [
          expect.objectContaining({
            sourceEntityId: '15037',
            matchMethod: 'name_candidate',
          }),
        ],
      }),
    );
  });

  it('does not attempt name fallback when no useful name exists', async () => {
    const vessel: VesselFingerprint = {
      id: 'v-4',
      mmsi: '572469212',
      imo: null,
      name: null,
    };
    const repo = makeRepo({
      findVesselFingerprintByMmsi: jest.fn(async () => vessel),
      findSanctionCandidatesByImo: jest.fn(async () => []),
      findSanctionCandidatesByMmsi: jest.fn(async () => []),
      findSanctionCandidatesByName: jest.fn(async () => []),
      applyEnrichment: jest.fn(async () => 1),
    });
    const processor = makeProcessor({ repo });

    const result = await processor.process({
      id: 'j',
      data: {
        vesselId: vessel.id,
        mmsi: vessel.mmsi,
        trigger: 'stale',
        profileHash: 'abc',
        observedImo: null,
        observedName: null,
      },
    } as unknown as Job<EnrichmentJobData>);

    expect(result).toEqual({ status: 'clear', matches: 0 });
    expect(repo.findSanctionCandidatesByName).not.toHaveBeenCalled();
    expect(repo.applyEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({
        vesselId: 'v-4',
        status: 'clear',
        matches: [],
      }),
    );
  });
});
