import { StorageWriterConsumer } from './storage-writer.consumer';
import { EventBus, EventBusHandler } from '../shared/bus/event-bus';
import { VesselsRepository } from './vessels.repository';
import { PositionEvent, StaticEvent, SCHEMA_VERSION } from '../contracts';
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
      ...overrides,
    };
  }

  it('upserts on a valid position event', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = {
      upsertPosition: jest.fn().mockResolvedValue(undefined),
      upsertProfile: jest.fn().mockResolvedValue(undefined),
    } as unknown as VesselsRepository;

    const consumer = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    await consumer.onModuleInit();

    const event = makeEvent();
    await captured!({ id: '1-0', payload: event });
    expect(repo.upsertPosition).toHaveBeenCalledWith(event);
    expect(repo.upsertProfile).not.toHaveBeenCalled();
  });

  it('upserts profile on a valid static event', async () => {
    let captured: EventBusHandler | null = null;
    const bus: EventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(async (_s, _g, _c, h) => {
        captured = h as EventBusHandler;
      }),
    };
    const repo = {
      upsertPosition: jest.fn(),
      upsertProfile: jest.fn().mockResolvedValue(undefined),
    } as unknown as VesselsRepository;

    const consumer = new StorageWriterConsumer(bus, repo, stubPinoLogger());
    await consumer.onModuleInit();

    const event = makeStaticEvent();
    await captured!({ id: '2-0', payload: event });
    expect(repo.upsertProfile).toHaveBeenCalledWith(event);
    expect(repo.upsertPosition).not.toHaveBeenCalled();
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

    await captured!({ id: '1-0', payload: { kind: 'position', schemaVersion: SCHEMA_VERSION, mmsi: 'bad' } });
    expect(repo.upsertPosition).not.toHaveBeenCalled();
  });
});
