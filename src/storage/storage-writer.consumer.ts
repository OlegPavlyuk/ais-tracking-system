import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { EVENT_BUS, EventBus } from '../shared/bus/event-bus';
import { AIS_EVENTS_STREAM, VESSEL_PERSISTED_STREAM } from '../shared/config/constants';
import {
  CanonicalEvent,
  CanonicalEventSchema,
  SCHEMA_VERSION,
  VesselPersistedEvent,
} from '../contracts';
import { PersistedVesselSummary, VesselsRepository } from './vessels.repository';

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
        this.logger.warn(
          `drop invalid canonical event ${msg.id}: ${parsed.error.issues[0]?.message}`,
        );
        return;
      }
      const event = parsed.data;
      const persisted =
        event.kind === 'position'
          ? await this.repo.upsertPosition(event)
          : await this.repo.upsertProfile(event);
      if (persisted) await this.publishPersistedEvent(event, persisted);
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
    this.logger.log(
      `subscribed to ${AIS_EVENTS_STREAM} group=${CONSUMER_GROUP} consumer=${consumer}`,
    );
  }

  private async publishPersistedEvent(
    source: CanonicalEvent,
    summary: PersistedVesselSummary,
  ): Promise<void> {
    const event: VesselPersistedEvent = {
      schemaVersion: SCHEMA_VERSION,
      kind: 'vessel.persisted',
      vesselId: summary.vesselId,
      mmsi: summary.mmsi,
      imo: summary.imo,
      name: summary.name,
      sourceEventKind: source.kind,
      persistedAt: new Date().toISOString(),
      ...(source.traceId ? { traceId: source.traceId } : {}),
    };

    try {
      await this.bus.publish(VESSEL_PERSISTED_STREAM, event);
    } catch (err) {
      this.pino.warn(
        {
          err: (err as Error).message,
          traceId: source.traceId,
          mmsi: summary.mmsi,
          vesselId: summary.vesselId,
          stream: VESSEL_PERSISTED_STREAM,
        },
        'failed to publish vessel persisted event',
      );
    }
  }
}
