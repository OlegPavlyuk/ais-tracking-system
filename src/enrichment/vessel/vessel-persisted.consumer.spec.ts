import { VesselPersistedEvent } from '../../contracts';
import { EventBus, EventBusHandler } from '../../shared/bus/event-bus';
import { VESSEL_PERSISTED_STREAM } from '../../shared/config/constants';
import { stubPinoLogger } from '../../shared/testing/metrics-stubs';
import {
  VESSEL_PERSISTED_CONSUMER_GROUP,
  VesselPersistedConsumer,
} from './vessel-persisted.consumer';

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

const setup = async () => {
  let handler: EventBusHandler<unknown> | undefined;
  const bus: EventBus = {
    publish: jest.fn(),
    subscribe: jest.fn(async (_stream, _group, _consumer, h) => {
      handler = h as EventBusHandler<unknown>;
    }),
  };
  const requester = { request: jest.fn(async () => undefined) };
  const consumer = new VesselPersistedConsumer(requester as never, stubPinoLogger(), bus);

  await consumer.onModuleInit();

  if (!handler) throw new Error('expected VesselPersistedConsumer to register a stream handler');
  return { bus, requester, handler, consumer };
};

describe('VesselPersistedConsumer', () => {
  it('subscribes to VESSEL_PERSISTED_STREAM', async () => {
    const { bus } = await setup();

    expect(bus.subscribe).toHaveBeenCalledTimes(1);
    const [stream, group, consumerName] = (bus.subscribe as jest.Mock).mock.calls[0]!;
    expect(stream).toBe(VESSEL_PERSISTED_STREAM);
    expect(group).toBe(VESSEL_PERSISTED_CONSUMER_GROUP);
    expect(consumerName).toEqual(expect.stringMatching(new RegExp(`^${VESSEL_PERSISTED_CONSUMER_GROUP}-`)));
  });

  it.each(['position', 'static'] as const)(
    'forwards valid %s persisted events to the requester',
    async (sourceEventKind) => {
      const { handler, requester } = await setup();

      const event = persistedEvent({ sourceEventKind });
      await handler({ id: '1-0', payload: event });

      expect(requester.request).toHaveBeenCalledTimes(1);
      expect(requester.request).toHaveBeenCalledWith(event);
    },
  );

  it('drops invalid payload without request', async () => {
    const { handler, requester } = await setup();

    await handler({ id: '1-0', payload: { ...persistedEvent(), mmsi: 'bad' } });

    expect(requester.request).not.toHaveBeenCalled();
  });
});
