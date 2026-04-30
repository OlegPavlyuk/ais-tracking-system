import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EVENT_BUS, EventBus } from '../shared/bus/event-bus';
import { AIS_EVENTS_STREAM } from '../shared/config/constants';
import { AisStreamAdapter } from '../ingestion/aisstream.adapter';
import { RawFilter } from '../ingestion/raw-filter';
import { AisStreamNormalizer } from './normalizer';

@Injectable()
export class IngestionPipelineService implements OnModuleInit {
  private readonly logger = new Logger(IngestionPipelineService.name);

  constructor(
    private readonly adapter: AisStreamAdapter,
    private readonly filter: RawFilter,
    private readonly normalizer: AisStreamNormalizer,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.adapter.onMessage(async (raw) => {
      if (!this.filter.accept(raw.payload)) return;
      const event = this.normalizer.normalize(raw);
      if (!event) return;
      try {
        await this.bus.publish(AIS_EVENTS_STREAM, event);
      } catch (err) {
        this.logger.error(
          `failed to publish event mmsi=${event.mmsi}: ${(err as Error).message}`,
        );
      }
    });
  }
}
