import { SCHEMA_VERSION, StaticEvent, VesselPersistedEvent } from '../../contracts';
import { EventBus, EventBusHandler } from '../../shared/bus/event-bus';
import { AIS_EVENTS_STREAM, VESSEL_PERSISTED_STREAM } from '../../shared/config/constants';
import { stubPinoLogger } from '../../shared/testing/metrics-stubs';
import { StorageWriterConsumer } from '../../storage/storage-writer.consumer';
import { VesselsRepository } from '../../storage/vessels.repository';
import { VesselPersistedConsumer } from './vessel-persisted.consumer';
import { VesselEnrichmentRequester } from './vessel-enrichment.requester';

const staticEvent = (overrides: Partial<StaticEvent> = {}): StaticEvent => ({
  schemaVersion: SCHEMA_VERSION,
  kind: 'static',
  mmsi: '210098000',
  imo: '9807322',
  name: 'STENA EMBLA',
  callSign: '5BQA5',
  shipType: 61,
  destination: 'BELFAST<>BIRKINHEAD',
  dimensionToBow: 55,
  dimensionToStern: 160,
  dimensionToPort: 3,
  dimensionToStarboard: 25,
  occurredAt: '2026-04-30T06:29:19.087Z',
  provider: 'aisstream',
  ingestedAt: '2026-04-30T06:29:19.200Z',
  traceId: '22222222-3333-4444-8555-666666666666',
  ...overrides,
});

class InMemoryEventBus implements EventBus {
  readonly published: { stream: string; payload: unknown }[] = [];
  readonly subscribe = jest.fn(
    async <T>(
      stream: string,
      _group: string,
      _consumer: string,
      handler: EventBusHandler<T>,
    ) => {
      this.handlers.set(stream, handler as EventBusHandler<unknown>);
    },
  );

  private readonly handlers = new Map<string, EventBusHandler<unknown>>();

  async publish<T>(stream: string, payload: T): Promise<string> {
    this.published.push({ stream, payload });
    const id = `${this.published.length}-0`;
    const handler = this.handlers.get(stream);
    if (handler) await handler({ id, payload });
    return id;
  }

  async emit<T>(stream: string, payload: T): Promise<void> {
    const handler = this.handlers.get(stream);
    if (!handler) throw new Error(`no handler registered for ${stream}`);
    await handler({ id: 'input-1', payload });
  }
}

describe('post-persistence storage-to-enrichment event flow', () => {
  it('publishes vessel.persisted after storage and passes it to the enrichment requester', async () => {
    const bus = new InMemoryEventBus();
    const repo = {
      upsertPosition: jest.fn(),
      upsertProfile: jest.fn().mockResolvedValue({
        vesselId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        mmsi: '210098000',
        imo: '9807322',
        name: 'STENA EMBLA',
      }),
    } as unknown as VesselsRepository;
    const requester = {
      request: jest.fn(async () => ({
        status: 'enqueued' as const,
        trigger: 'discovered' as const,
        jobId: 'enrich.bbbbbbbb-cccc-4ddd-8eee-ffffffffffff.discovered.hash',
      })),
    } as unknown as VesselEnrichmentRequester;

    const storage = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    const enrichment = new VesselPersistedConsumer(requester, stubPinoLogger(), bus);
    await storage.onModuleInit();
    await enrichment.onModuleInit();

    expect(bus.subscribe).toHaveBeenCalledWith(
      AIS_EVENTS_STREAM,
      expect.any(String),
      expect.any(String),
      expect.any(Function),
    );
    expect(bus.subscribe).toHaveBeenCalledWith(
      VESSEL_PERSISTED_STREAM,
      expect.any(String),
      expect.any(String),
      expect.any(Function),
    );

    const event = staticEvent();
    await bus.emit(AIS_EVENTS_STREAM, event);

    expect(repo.upsertProfile).toHaveBeenCalledWith(event);
    expect(repo.upsertPosition).not.toHaveBeenCalled();

    const persistedPublish = bus.published.find((publish) => publish.stream === VESSEL_PERSISTED_STREAM);
    expect(persistedPublish).toBeDefined();
    const persisted = persistedPublish!.payload as VesselPersistedEvent;
    expect(persisted).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      kind: 'vessel.persisted',
      vesselId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      mmsi: '210098000',
      imo: '9807322',
      name: 'STENA EMBLA',
      sourceEventKind: 'static',
      traceId: '22222222-3333-4444-8555-666666666666',
    });
    expect(typeof persisted.persistedAt).toBe('string');

    expect(requester.request).toHaveBeenCalledTimes(1);
    expect(requester.request).toHaveBeenCalledWith(persisted);
  });
});
