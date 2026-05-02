import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { SCHEMA_VERSION, VesselEnrichedEvent } from '../../contracts';
import { EVENT_BUS, EventBus } from '../../shared/bus/event-bus';
import { VESSEL_ENRICHED_STREAM } from '../../shared/config/constants';
import { ConfigService } from '../../shared/config/config.service';
import {
  ENRICHMENT_REDIS,
  ENRICHMENT_VESSEL_QUEUE,
  EnrichmentJobData,
  checkedKey,
  profileHashFor,
  profileKey,
} from './enrichment-dispatcher';
import { EnrichmentRepository } from './enrichment.repository';
import { match } from './matcher';

@Processor(ENRICHMENT_VESSEL_QUEUE, { concurrency: 1 })
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);

  constructor(
    @Inject(EnrichmentRepository) private readonly repo: EnrichmentRepository,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(ENRICHMENT_REDIS) private readonly redis: Pick<Redis, 'set' | 'expire'>,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<EnrichmentJobData>): Promise<{ status: string; matches: number }> {
    const { vesselId, mmsi } = job.data;
    const fingerprint = await this.repo.findVesselFingerprintByMmsi(mmsi);
    if (!fingerprint || fingerprint.id !== vesselId) {
      this.logger.warn(`vessel ${vesselId} (mmsi=${mmsi}) not resolvable; skipping`);
      return { status: 'skipped', matches: 0 };
    }

    const candidates = await this.repo.loadAllSanctionCandidates();
    const result = match(
      { imo: fingerprint.imo, mmsi: fingerprint.mmsi, name: fingerprint.name },
      candidates,
    );

    const checkedAt = new Date().toISOString();
    const updated = await this.repo.applyEnrichment({
      vesselId,
      status: result.status,
      matches: result.matches,
      checkedAt,
    });

    if (updated === 0) {
      this.logger.debug?.(`enrichment guard skipped update for vessel=${vesselId}`);
      return { status: 'noop', matches: result.matches.length };
    }

    const enriched: VesselEnrichedEvent = {
      schemaVersion: SCHEMA_VERSION,
      vesselId,
      mmsi,
      status: result.status,
      matches: result.matches,
      checkedAt,
    };
    await this.bus.publish(VESSEL_ENRICHED_STREAM, enriched);

    const ttl = this.config.get('ENRICHMENT_STALENESS_SECONDS');
    const cachedHash = profileHashFor({ imo: fingerprint.imo, name: fingerprint.name });
    await this.redis.set(profileKey(vesselId), cachedHash);
    await this.redis.set(checkedKey(vesselId), checkedAt, 'EX', ttl);

    this.logger.log(
      `enriched vessel=${vesselId} mmsi=${mmsi} status=${result.status} matches=${result.matches.length}`,
    );
    return { status: result.status, matches: result.matches.length };
  }
}
