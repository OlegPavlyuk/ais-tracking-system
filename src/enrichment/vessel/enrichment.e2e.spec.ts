import { Job } from 'bullmq';
import { CanonicalEvent } from '../../contracts';
import {
  EnrichmentDispatcher,
  EnrichmentJobData,
  profileHashFor,
} from './enrichment-dispatcher';
import { EnrichmentProcessor } from './enrichment.processor';
import { EnrichmentRepository, VesselFingerprint } from './enrichment.repository';
import { SanctionCandidate } from './matcher';
import { VESSEL_ENRICHED_STREAM } from '../../shared/config/constants';
import { ConfigService } from '../../shared/config/config.service';
import { EventBus } from '../../shared/bus/event-bus';

describe('enrichment loop (dispatcher + processor)', () => {
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
    };

    const repo = {
      findVesselFingerprintByMmsi: jest.fn(async (mmsi: string) =>
        mmsi === vessel.mmsi ? vessel : null,
      ),
      loadAllSanctionCandidates: jest.fn(async () => [sanctioned]),
      applyEnrichment: jest.fn(async () => 1),
    } as unknown as EnrichmentRepository;

    const redisStore = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        redisStore.set(k, v);
        return 'OK' as const;
      }),
      expire: jest.fn(async () => 1),
    };

    const queueCalls: { name: string; data: EnrichmentJobData; opts?: Record<string, unknown> }[] = [];
    const queue = {
      add: jest.fn(async (name: string, data: EnrichmentJobData, opts?: Record<string, unknown>) => {
        queueCalls.push({ name, data, opts });
        return undefined;
      }),
    };

    const dispatcher = new EnrichmentDispatcher(
      queue as never,
      redis as never,
      repo,
      undefined,
    );

    const positionEvent: CanonicalEvent = {
      schemaVersion: 1,
      kind: 'position',
      mmsi: vessel.mmsi,
      lat: 41,
      lon: 30,
      occurredAt: '2026-05-02T00:00:00.000Z',
      provider: 'aisstream',
      ingestedAt: '2026-05-02T00:00:00.500Z',
    } as CanonicalEvent;

    await dispatcher.handle(positionEvent);

    expect(queueCalls).toHaveLength(1);
    const enq = queueCalls[0]!;
    expect(enq.data).toMatchObject({
      vesselId: 'v-1',
      mmsi: vessel.mmsi,
      trigger: 'discovered',
      profileHash: profileHashFor({ imo: '9187629', name: 'ARTAVIL' }),
    });

    const published: { stream: string; payload: unknown }[] = [];
    const bus: EventBus = {
      publish: jest.fn(async (stream: string, payload: unknown) => {
        published.push({ stream, payload });
        return '1-0';
      }),
      subscribe: jest.fn(async () => undefined),
    };

    const config = {
      get: jest.fn((k: string) => (k === 'ENRICHMENT_STALENESS_SECONDS' ? 604800 : undefined)),
    } as unknown as ConfigService;

    const processor = new EnrichmentProcessor(repo, bus, redis as never, config);
    const job = { id: 'job-1', data: enq.data } as unknown as Job<EnrichmentJobData>;
    const result = await processor.process(job);

    expect(result).toEqual({ status: 'sanctioned', matches: 1 });
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
        }),
      ],
    });

    expect(redisStore.get('enrich:profile:v-1')).toBe(
      profileHashFor({ imo: '9187629', name: 'ARTAVIL' }),
    );
    expect(redisStore.get('enrich:checked:v-1')).toBeDefined();
  });

  it('skips publishing when timestamp guard rejects the update', async () => {
    const vessel: VesselFingerprint = {
      id: 'v-2',
      mmsi: '572438210',
      imo: null,
      name: 'OTHER',
    };
    const repo = {
      findVesselFingerprintByMmsi: jest.fn(async () => vessel),
      loadAllSanctionCandidates: jest.fn(async () => []),
      applyEnrichment: jest.fn(async () => 0),
    } as unknown as EnrichmentRepository;
    const bus: EventBus = { publish: jest.fn(), subscribe: jest.fn() };
    const redis = { set: jest.fn(), get: jest.fn() };
    const config = {
      get: jest.fn(() => 604800),
    } as unknown as ConfigService;

    const processor = new EnrichmentProcessor(repo, bus, redis as never, config);
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
});
