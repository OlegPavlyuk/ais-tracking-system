import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import {
  ENRICHMENT_REDIS,
  ENRICHMENT_VESSEL_QUEUE,
  EnrichmentJobData,
  EnrichmentTrigger,
} from './enrichment.types';
import { normalizeName } from './matcher';

interface ProfileFingerprint {
  imo: string | null;
  name: string | null;
}

export interface VesselEnrichmentRequest {
  vesselId: string;
  mmsi: string;
  imo: string | null;
  name: string | null;
  traceId?: string;
}

export type VesselEnrichmentRequestResult =
  | { status: 'enqueued'; trigger: EnrichmentTrigger; jobId: string }
  | { status: 'skipped'; reason: 'fresh' };

export function profileHashFor(p: ProfileFingerprint): string {
  const payload = JSON.stringify({ imo: p.imo ?? '', name: normalizeName(p.name) });
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

export const profileKey = (vesselId: string): string => `enrich:profile:${vesselId}`;
export const checkedKey = (vesselId: string): string => `enrich:checked:${vesselId}`;

@Injectable()
export class VesselEnrichmentRequester {
  constructor(
    @InjectQueue(ENRICHMENT_VESSEL_QUEUE) private readonly queue: Queue<EnrichmentJobData>,
    @Inject(ENRICHMENT_REDIS) private readonly redis: Pick<Redis, 'get'>,
    private readonly pino: PinoLogger,
  ) {
    this.pino.setContext(VesselEnrichmentRequester.name);
  }

  async request(request: VesselEnrichmentRequest): Promise<VesselEnrichmentRequestResult> {
    const candidateHash = profileHashFor(request);

    const [cachedProfile, cachedChecked] = await Promise.all([
      this.redis.get(profileKey(request.vesselId)),
      this.redis.get(checkedKey(request.vesselId)),
    ]);

    const trigger = this.decide(cachedProfile, cachedChecked, candidateHash);
    if (!trigger) return { status: 'skipped', reason: 'fresh' };

    const jobId = `enrich.${request.vesselId}.${trigger}.${candidateHash}`;
    await this.queue.add(
      'enrich',
      {
        vesselId: request.vesselId,
        mmsi: request.mmsi,
        trigger,
        profileHash: candidateHash,
        observedImo: request.imo,
        observedName: request.name,
        traceId: request.traceId,
      },
      { jobId, removeOnComplete: 200, removeOnFail: 200 },
    );
    this.pino.debug(
      {
        traceId: request.traceId,
        mmsi: request.mmsi,
        vesselId: request.vesselId,
        trigger,
        jobId,
      },
      'enqueued enrichment job',
    );
    return { status: 'enqueued', trigger, jobId };
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
