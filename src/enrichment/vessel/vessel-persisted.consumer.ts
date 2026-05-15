import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { VesselPersistedEvent, VesselPersistedEventSchema } from '../../contracts';
import { EVENT_BUS, EventBus } from '../../shared/bus/event-bus';
import { VESSEL_PERSISTED_STREAM } from '../../shared/config/constants';
import { VesselEnrichmentRequester } from './vessel-enrichment.requester';

export const VESSEL_PERSISTED_CONSUMER_GROUP = 'vessel-enrichment-dispatcher';

@Injectable()
export class VesselPersistedConsumer implements OnModuleInit {
  constructor(
    private readonly requester: VesselEnrichmentRequester,
    private readonly pino: PinoLogger,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {
    this.pino.setContext(VesselPersistedConsumer.name);
  }

  async onModuleInit(): Promise<void> {
    const consumer = `${VESSEL_PERSISTED_CONSUMER_GROUP}-${process.pid}`;
    await this.bus.subscribe<unknown>(VESSEL_PERSISTED_STREAM, VESSEL_PERSISTED_CONSUMER_GROUP, consumer, async (msg) => {
      const parsed = VesselPersistedEventSchema.safeParse(msg.payload);
      if (!parsed.success) {
        this.pino.warn(
          {
            stream: VESSEL_PERSISTED_STREAM,
            messageId: msg.id,
            issue: parsed.error.issues[0]?.message,
          },
          'drop invalid vessel persisted event',
        );
        return;
      }
      await this.handle(parsed.data);
    });
    this.pino.info(
      { stream: VESSEL_PERSISTED_STREAM, consumerGroup: VESSEL_PERSISTED_CONSUMER_GROUP, consumer },
      'subscribed to vessel persisted stream',
    );
  }

  async handle(event: VesselPersistedEvent): Promise<void> {
    await this.requester.request(event);
  }
}
