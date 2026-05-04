import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { CanonicalEvent, CanonicalEventSchema } from '../../contracts';
import { EVENT_BUS, EventBus } from '../../shared/bus/event-bus';
import { AIS_EVENTS_STREAM } from '../../shared/config/constants';
import { RedisService } from '../../shared/redis/redis.service';
import { EnrichmentRepository, VesselFingerprint } from './enrichment.repository';
import { normalizeName } from './matcher';

export const ENRICHMENT_VESSEL_QUEUE = 'enrichment.vessel';

const CONSUMER_GROUP = 'enrichment-dispatcher';

export type EnrichmentTrigger = 'discovered' | 'stale' | 'profile_changed';

export interface EnrichmentJobData {
  vesselId: string;
  mmsi: string;
  trigger: EnrichmentTrigger;
  profileHash: string;
  observedImo: string | null;
  observedName: string | null;
  /** Originating canonical-event traceId, for end-to-end log correlation. */
  traceId?: string;
}

interface ProfileFingerprint {
  imo: string | null;
  name: string | null;
}

export function profileHashFor(p: ProfileFingerprint): string {
  const payload = JSON.stringify({ imo: p.imo ?? '', name: normalizeName(p.name) });
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

export const profileKey = (vesselId: string): string => `enrich:profile:${vesselId}`;
export const checkedKey = (vesselId: string): string => `enrich:checked:${vesselId}`;

@Injectable()
export class EnrichmentDispatcher implements OnModuleInit {
  private readonly logger = new Logger(EnrichmentDispatcher.name);

  constructor(
    @InjectQueue(ENRICHMENT_VESSEL_QUEUE) private readonly queue: Queue<EnrichmentJobData>,
    @Inject('ENRICHMENT_REDIS') private readonly redis: Pick<Redis, 'get'>,
    @Inject(EnrichmentRepository) private readonly repo: EnrichmentRepository,
    private readonly pino: PinoLogger,
    @Inject(EVENT_BUS) private readonly bus?: EventBus,
  ) {
    this.pino.setContext(EnrichmentDispatcher.name);
  }

  async onModuleInit(): Promise<void> {
    if (!this.bus) return;
    const consumer = `enrichment-dispatcher-${process.pid}`;
    await this.bus.subscribe<unknown>(AIS_EVENTS_STREAM, CONSUMER_GROUP, consumer, async (msg) => {
      const parsed = CanonicalEventSchema.safeParse(msg.payload);
      if (!parsed.success) {
        this.logger.warn(`drop invalid canonical event ${msg.id}: ${parsed.error.issues[0]?.message}`);
        return;
      }
      await this.handle(parsed.data);
    });
    this.logger.log(`subscribed to ${AIS_EVENTS_STREAM} group=${CONSUMER_GROUP} consumer=${consumer}`);
  }

  async handle(event: CanonicalEvent): Promise<void> {
    const vessel = await this.repo.findVesselFingerprintByMmsi(event.mmsi);
    if (!vessel) return;

    const candidate = this.candidateProfile(event, vessel);
    const candidateHash = profileHashFor(candidate);

    const [cachedProfile, cachedChecked] = await Promise.all([
      this.redis.get(profileKey(vessel.id)),
      this.redis.get(checkedKey(vessel.id)),
    ]);

    const trigger = this.decide(cachedProfile, cachedChecked, candidateHash);
    if (!trigger) return;

    const jobId = `enrich.${vessel.id}.${trigger}.${candidateHash}`;
    await this.queue.add(
      'enrich',
      {
        vesselId: vessel.id,
        mmsi: event.mmsi,
        trigger,
        profileHash: candidateHash,
        observedImo: candidate.imo,
        observedName: candidate.name,
        traceId: event.traceId,
      },
      { jobId, removeOnComplete: 200, removeOnFail: 200 },
    );
    this.pino.debug(
      {
        traceId: event.traceId,
        mmsi: event.mmsi,
        vesselId: vessel.id,
        provider: event.provider,
        consumerGroup: CONSUMER_GROUP,
        trigger,
        jobId,
      },
      'enqueued enrichment job',
    );
  }

  private candidateProfile(event: CanonicalEvent, vessel: VesselFingerprint): ProfileFingerprint {
    if (event.kind === 'static') {
      return {
        imo: event.imo ?? vessel.imo,
        name: event.name ?? vessel.name,
      };
    }
    return { imo: vessel.imo, name: vessel.name };
  }

  private decide(
    cachedProfile: string | null,
    cachedChecked: string | null,
    candidateHash: string,
  ): EnrichmentTrigger | null {
    if (cachedProfile === null) return 'discovered';
    if (cachedProfile !== candidateHash) return 'profile_changed';
    if (cachedChecked === null) return 'stale';
    return null;
  }
}

export const ENRICHMENT_REDIS = 'ENRICHMENT_REDIS';

export const enrichmentRedisProvider = {
  provide: ENRICHMENT_REDIS,
  inject: [RedisService],
  useFactory: (redis: RedisService) => redis.client,
};
