import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { EVENT_BUS, EventBus } from '../shared/bus/event-bus';
import { AIS_EVENTS_STREAM } from '../shared/config/constants';
import { CanonicalEventSchema } from '../contracts';
import { VesselsRepository } from './vessels.repository';

const CONSUMER_GROUP = 'storage-writer';

@Injectable()
export class StorageWriterConsumer implements OnModuleInit {
  private readonly logger = new Logger(StorageWriterConsumer.name);

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly repo: VesselsRepository,
    private readonly pino: PinoLogger,
  ) {
    this.pino.setContext(StorageWriterConsumer.name);
  }

  async onModuleInit(): Promise<void> {
    const consumer = `storage-writer-${process.pid}`;
    await this.bus.subscribe<unknown>(AIS_EVENTS_STREAM, CONSUMER_GROUP, consumer, async (msg) => {
      const parsed = CanonicalEventSchema.safeParse(msg.payload);
      if (!parsed.success) {
        this.logger.warn(`drop invalid canonical event ${msg.id}: ${parsed.error.issues[0]?.message}`);
        return;
      }
      const event = parsed.data;
      if (event.kind === 'position') {
        await this.repo.upsertPosition(event);
      } else {
        await this.repo.upsertProfile(event);
      }
      this.pino.debug(
        {
          traceId: event.traceId,
          mmsi: event.mmsi,
          provider: event.provider,
          kind: event.kind,
          streamMessageId: msg.id,
          consumerGroup: CONSUMER_GROUP,
        },
        'wrote',
      );
    });
    this.logger.log(`subscribed to ${AIS_EVENTS_STREAM} group=${CONSUMER_GROUP} consumer=${consumer}`);
  }
}
