import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CanonicalEventSchema } from '../contracts';
import { EVENT_BUS, EventBus } from '../shared/bus/event-bus';
import { AIS_EVENTS_STREAM } from '../shared/config/constants';
import { RealtimeGateway } from './realtime.gateway';
import { SubscriptionService } from './subscription.service';

const CONSUMER_GROUP = 'realtime-fanout';

@Injectable()
export class FanoutConsumer implements OnModuleInit {
  private readonly logger = new Logger(FanoutConsumer.name);

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly subs: SubscriptionService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    const consumer = `realtime-fanout-${process.pid}`;
    await this.bus.subscribe<unknown>(AIS_EVENTS_STREAM, CONSUMER_GROUP, consumer, async (msg) => {
      const parsed = CanonicalEventSchema.safeParse(msg.payload);
      if (!parsed.success) {
        this.logger.warn(`drop invalid canonical event ${msg.id}: ${parsed.error.issues[0]?.message}`);
        return;
      }
      const event = parsed.data;
      if (event.kind === 'position') {
        for (const id of this.subs.matchPosition(event.lat, event.lon)) {
          this.gateway.enqueue(id, { type: 'position', data: event });
        }
      } else {
        for (const id of this.subs.allSubscribed()) {
          this.gateway.enqueue(id, { type: 'static', data: event });
        }
      }
    });
    this.logger.log(`subscribed to ${AIS_EVENTS_STREAM} group=${CONSUMER_GROUP} consumer=${consumer}`);
  }
}
