import { StorageWriterConsumer } from './storage-writer.consumer';
import { EventBus, EventBusHandler } from '../shared/bus/event-bus';
import { VesselsRepository } from './vessels.repository';
import { PositionEvent, StaticEvent, SCHEMA_VERSION, VesselPersistedEvent } from '../contracts';
import { VESSEL_PERSISTED_STREAM } from '../shared/config/constants';
import { stubPinoLogger } from '../shared/testing/metrics-stubs';

describe('StorageWriterConsumer', () => {
  function makeEvent(overrides: Partial<PositionEvent> = {}): PositionEvent {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'position',
      mmsi: '241935000',
      lat: 41.5,
      lon: 41.5,
      sog: 0.1,
      cog: 26.9,
      trueHeading: 261,
      navStatus: 5,
      rateOfTurn: 0,
      shipName: 'SEA MOON',
      occurredAt: '2026-04-28T04:52:17.518Z',
      provider: 'aisstream',
      ingestedAt: '2026-04-28T04:52:17.600Z',
      traceId: '11111111-2222-4333-8444-555555555555',
      ...overrides,
    };
  }

  function makeStaticEvent(overrides: Partial<StaticEvent> = {}): StaticEvent {
    return {
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
    };
  }

  it('upserts and publishes vessel.persisted on a valid position event', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn(async () => '3-0'),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = {
      upsertPosition: jest.fn().mockResolvedValue({
        vesselId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        mmsi: '241935000',
        imo: null,
        name: 'SEA MOON',
      }),
      upsertProfile: jest.fn(),
    } as unknown as VesselsRepository;

    const consumer = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    await consumer.onModuleInit();

    const event = makeEvent();
    await captured!({ id: '1-0', payload: event });
    expect(repo.upsertPosition).toHaveBeenCalledWith(event);
    expect(repo.upsertProfile).not.toHaveBeenCalled();
    expect(bus.publish).toHaveBeenCalledTimes(1);
    const [stream, payload] = (bus.publish as jest.Mock).mock.calls[0]!;
    expect(stream).toBe(VESSEL_PERSISTED_STREAM);
    expect(payload).toMatchObject<Partial<VesselPersistedEvent>>({
      schemaVersion: SCHEMA_VERSION,
      kind: 'vessel.persisted',
      vesselId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      mmsi: '241935000',
      imo: null,
      name: 'SEA MOON',
      sourceEventKind: 'position',
      traceId: '11111111-2222-4333-8444-555555555555',
    });
    expect(typeof (payload as VesselPersistedEvent).persistedAt).toBe('string');
  });

  it('upserts profile and publishes vessel.persisted on a valid static event', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn(async () => '3-0'),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = {
      upsertPosition: jest.fn(),
      upsertProfile: jest.fn().mockResolvedValue({
        vesselId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        mmsi: '210098000',
        imo: '9807322',
        name: 'STENA EMBLA',
      }),
    } as unknown as VesselsRepository;

    const consumer = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    await consumer.onModuleInit();

    const event = makeStaticEvent();
    await captured!({ id: '2-0', payload: event });
    expect(repo.upsertProfile).toHaveBeenCalledWith(event);
    expect(repo.upsertPosition).not.toHaveBeenCalled();
    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(bus.publish).toHaveBeenCalledWith(
      VESSEL_PERSISTED_STREAM,
      expect.objectContaining<Partial<VesselPersistedEvent>>({
        schemaVersion: SCHEMA_VERSION,
        kind: 'vessel.persisted',
        vesselId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        mmsi: '210098000',
        imo: '9807322',
        name: 'STENA EMBLA',
        sourceEventKind: 'static',
        traceId: '22222222-3333-4444-8555-666666666666',
      }),
    );
  });

  it('drops invalid canonical events without throwing', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = { upsertPosition: jest.fn() } as unknown as VesselsRepository;

    const consumer = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    await consumer.onModuleInit();

    await captured!({
      id: '1-0',
      payload: { kind: 'position', schemaVersion: SCHEMA_VERSION, mmsi: 'bad' },
    });
    expect(repo.upsertPosition).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('does not publish when storage intentionally skips persistence', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = {
      upsertPosition: jest.fn().mockResolvedValue(null),
    } as unknown as VesselsRepository;

    const consumer = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    await consumer.onModuleInit();

    await captured!({ id: '1-0', payload: makeEvent() });
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('propagates storage failures so the canonical event can be retried', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = {
      upsertPosition: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as VesselsRepository;

    const consumer = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    await consumer.onModuleInit();

    await expect(captured!({ id: '1-0', payload: makeEvent() })).rejects.toThrow('db down');
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('swallows persisted-event publish failures after storage succeeds', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn().mockRejectedValue(new Error('redis down')),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = {
      upsertPosition: jest.fn().mockResolvedValue({
        vesselId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        mmsi: '241935000',
        imo: null,
        name: 'SEA MOON',
      }),
    } as unknown as VesselsRepository;
    const pino = stubPinoLogger();
    const warnSpy = jest.spyOn(pino, 'warn');

    const consumer = new StorageWriterConsumer(bus, repo, pino);
    await consumer.onModuleInit();

    await expect(captured!({ id: '1-0', payload: makeEvent() })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: 'redis down',
        mmsi: '241935000',
        vesselId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        stream: VESSEL_PERSISTED_STREAM,
      }),
      'failed to publish vessel persisted event',
    );
  });
});
