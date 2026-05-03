import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { EVENT_BUS, EventBus } from '../shared/bus/event-bus';
import { AIS_EVENTS_STREAM } from '../shared/config/constants';
import {
  AIS_MESSAGES_DROPPED_TOTAL,
  DropReason,
} from '../shared/metrics/drop-reasons';
import { RawProviderMessage } from '../contracts';
import { ProviderRegistry } from '../ingestion/provider-registry';
import { ProviderNormalizer } from '../ingestion/provider';
import { DedupService } from './dedup.service';
import { SamplerService } from './sampler.service';

@Injectable()
export class IngestionPipelineService implements OnModuleInit {
  private readonly logger = new Logger(IngestionPipelineService.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly dedup: DedupService,
    private readonly sampler: SamplerService,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @InjectMetric(AIS_MESSAGES_DROPPED_TOTAL)
    private readonly droppedCounter: Counter<'reason'>,
  ) {}

  onModuleInit(): void {
    for (const { adapter, normalizer } of this.registry.providers()) {
      adapter.onMessage((raw) => {
        this.handle(raw, normalizer).catch((err) => {
          this.logger.error(
            `pipeline error for provider=${adapter.id}: ${(err as Error).message}`,
          );
        });
      });
    }
  }

  private async handle(
    raw: RawProviderMessage<unknown>,
    normalizer: ProviderNormalizer,
  ): Promise<void> {
    const event = normalizer.normalize(raw);
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
    await this.bus.publish(AIS_EVENTS_STREAM, event);
  }

  private drop(reason: DropReason): void {
    this.droppedCounter.inc({ reason });
  }
}
