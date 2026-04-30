import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { EVENT_BUS, EventBus } from '../shared/bus/event-bus';
import { AIS_EVENTS_STREAM } from '../shared/config/constants';
import {
  AIS_MESSAGES_DROPPED_TOTAL,
  DropReason,
} from '../shared/metrics/drop-reasons';
import { AisStreamAdapter } from '../ingestion/aisstream.adapter';
import { RawFilter } from '../ingestion/raw-filter';
import { AisStreamNormalizer } from './normalizer';
import { DedupService } from './dedup.service';
import { SamplerService } from './sampler.service';

@Injectable()
export class IngestionPipelineService implements OnModuleInit {
  private readonly logger = new Logger(IngestionPipelineService.name);

  constructor(
    private readonly adapter: AisStreamAdapter,
    private readonly filter: RawFilter,
    private readonly normalizer: AisStreamNormalizer,
    private readonly dedup: DedupService,
    private readonly sampler: SamplerService,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @InjectMetric(AIS_MESSAGES_DROPPED_TOTAL)
    private readonly droppedCounter: Counter<'reason'>,
  ) {}

  onModuleInit(): void {
    this.adapter.onMessage(async (raw) => {
      const filterResult = this.filter.accept(raw.payload);
      if (!filterResult.accepted) {
        this.drop(filterResult.reason);
        return;
      }

      const event = this.normalizer.normalize(raw);
      if (!event) {
        this.drop('invalid');
        return;
      }

      if (!(await this.dedup.shouldAccept(event.mmsi, event.occurredAt))) {
        this.drop('duplicate');
        return;
      }

      if (event.kind === 'position' && !(await this.sampler.shouldEmit(event))) {
        this.drop('sampled');
        return;
      }

      try {
        await this.bus.publish(AIS_EVENTS_STREAM, event);
      } catch (err) {
        this.logger.error(
          `failed to publish event mmsi=${event.mmsi}: ${(err as Error).message}`,
        );
      }
    });
  }

  private drop(reason: DropReason): void {
    this.droppedCounter.inc({ reason });
  }
}
