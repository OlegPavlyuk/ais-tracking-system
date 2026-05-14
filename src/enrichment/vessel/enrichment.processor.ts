import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { PinoLogger } from 'nestjs-pino';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { SCHEMA_VERSION, VesselEnrichedEvent } from '../../contracts';
import { EVENT_BUS, EventBus } from '../../shared/bus/event-bus';
import { VESSEL_ENRICHED_STREAM } from '../../shared/config/constants';
import { ConfigService } from '../../shared/config/config.service';
import { ENRICHMENT_JOBS_TOTAL, SANCTIONS_MATCHES_TOTAL } from '../../shared/metrics/metric-names';
import {
  ENRICHMENT_REDIS,
  ENRICHMENT_VESSEL_QUEUE,
  EnrichmentJobData,
  checkedKey,
  profileHashFor,
  profileKey,
} from './enrichment-dispatcher';
import { EnrichmentRepository } from './enrichment.repository';
import { match, MatchInput, MatchResult, normalizeName, SanctionCandidate } from './matcher';

@Processor(ENRICHMENT_VESSEL_QUEUE, { concurrency: 1 })
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);

  constructor(
    @Inject(EnrichmentRepository) private readonly repo: EnrichmentRepository,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(ENRICHMENT_REDIS) private readonly redis: Pick<Redis, 'set' | 'expire'>,
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectMetric(ENRICHMENT_JOBS_TOTAL)
    private readonly jobsCounter: Counter<'status'>,
    @InjectMetric(SANCTIONS_MATCHES_TOTAL)
    private readonly matchesCounter: Counter<'match_type'>,
    private readonly pino: PinoLogger,
  ) {
    super();
    this.pino.setContext(EnrichmentProcessor.name);
  }

  async process(job: Job<EnrichmentJobData>): Promise<{ status: string; matches: number }> {
    const { vesselId, mmsi, traceId } = job.data;
    const fingerprint = await this.repo.findVesselFingerprintByMmsi(mmsi);
    if (!fingerprint || fingerprint.id !== vesselId) {
      this.pino.warn({ vesselId, mmsi, traceId }, 'vessel not resolvable; skipping');
      this.jobsCounter.inc({ status: 'skipped' });
      return { status: 'skipped', matches: 0 };
    }

    const result = await this.matchSanctions({
      imo: fingerprint.imo,
      mmsi: fingerprint.mmsi,
      name: fingerprint.name,
    });

    const checkedAt = new Date().toISOString();
    const updated = await this.repo.applyEnrichment({
      vesselId,
      status: result.status,
      matches: result.matches,
      checkedAt,
    });

    if (updated === 0) {
      this.pino.debug({ vesselId, mmsi, traceId }, 'enrichment guard skipped update');
      this.jobsCounter.inc({ status: 'noop' });
      return { status: 'noop', matches: result.matches.length };
    }

    for (const m of result.matches) {
      this.matchesCounter.inc({ match_type: m.matchMethod });
    }
    this.jobsCounter.inc({ status: result.status });

    const enriched: VesselEnrichedEvent = {
      schemaVersion: SCHEMA_VERSION,
      vesselId,
      mmsi,
      status: result.status,
      matches: result.matches,
      checkedAt,
      ...(traceId ? { traceId } : {}),
    };
    await this.bus.publish(VESSEL_ENRICHED_STREAM, enriched);

    const ttl = this.config.get('ENRICHMENT_STALENESS_SECONDS');
    const cachedHash = profileHashFor({ imo: fingerprint.imo, name: fingerprint.name });
    await this.redis.set(profileKey(vesselId), cachedHash);
    await this.redis.set(checkedKey(vesselId), checkedAt, 'EX', ttl);

    this.pino.info(
      {
        vesselId,
        mmsi,
        traceId,
        status: result.status,
        matches: result.matches.length,
      },
      'enriched',
    );
    return { status: result.status, matches: result.matches.length };
  }

  private async matchSanctions(input: MatchInput): Promise<MatchResult> {
    const identifierCandidates: SanctionCandidate[] = [];
    if (input.imo) {
      identifierCandidates.push(...(await this.repo.findSanctionCandidatesByImo(input.imo)));
    }
    if (input.mmsi) {
      identifierCandidates.push(...(await this.repo.findSanctionCandidatesByMmsi(input.mmsi)));
    }

    const identifierResult = match(input, identifierCandidates);
    if (identifierResult.status === 'sanctioned') return identifierResult;

    const nameCandidates =
      normalizeName(input.name).length > 0
        ? await this.repo.findSanctionCandidatesByName(input.name)
        : [];
    return match(input, nameCandidates);
  }
}
