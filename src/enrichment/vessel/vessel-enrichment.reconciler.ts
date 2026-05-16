import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '../../shared/config/config.service';
import { EnrichmentRepository } from './enrichment.repository';
import { VesselEnrichmentRequester } from './vessel-enrichment.requester';

export interface VesselEnrichmentReconciliationResult {
  scanned: number;
  enqueued: number;
  skipped: number;
  failed: number;
  skippedRun: boolean;
}

/**
 * Recovers vessels that are unchecked or stale. Profile changes are normally
 * handled by the post-persistence vessel.persisted.v1 flow; if that immediate
 * event is missed, the vessel will still be rechecked once it becomes stale.
 */
@Injectable()
export class VesselEnrichmentReconciler implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly repo: EnrichmentRepository,
    private readonly requester: VesselEnrichmentRequester,
    private readonly config: ConfigService,
    private readonly pino: PinoLogger,
  ) {
    this.pino.setContext(VesselEnrichmentReconciler.name);
  }

  async onModuleInit(): Promise<void> {
    const intervalMs = this.config.get('ENRICHMENT_RECONCILIATION_INTERVAL_MS');
    this.timer = setInterval(() => {
      this.runOnce().catch((err) => {
        this.pino.error({ err }, 'vessel enrichment reconciliation tick failed');
      });
    }, intervalMs);
    this.timer.unref?.();

    this.runOnce().catch((err) => {
      this.pino.error({ err }, 'vessel enrichment startup reconciliation failed');
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now = new Date()): Promise<VesselEnrichmentReconciliationResult> {
    if (this.inFlight) {
      this.pino.debug('vessel enrichment reconciliation skipped because previous run is active');
      return { scanned: 0, enqueued: 0, skipped: 0, failed: 0, skippedRun: true };
    }

    this.inFlight = true;
    try {
      const batchSize = this.config.get('ENRICHMENT_RECONCILIATION_BATCH_SIZE');
      const stalenessSeconds = this.config.get('ENRICHMENT_STALENESS_SECONDS');
      const staleBefore = new Date(now.getTime() - stalenessSeconds * 1000).toISOString();
      const candidates = await this.repo.findVesselsNeedingEnrichment(batchSize, staleBefore);

      let enqueued = 0;
      let skipped = 0;
      let failed = 0;
      for (const candidate of candidates) {
        try {
          const result = await this.requester.request({
            vesselId: candidate.id,
            mmsi: candidate.mmsi,
            imo: candidate.imo,
            name: candidate.name,
          });
          if (result.status === 'enqueued') {
            enqueued += 1;
          } else {
            skipped += 1;
          }
        } catch (err) {
          failed += 1;
          this.pino.warn(
            { err, vesselId: candidate.id, mmsi: candidate.mmsi },
            'vessel enrichment reconciliation request failed',
          );
        }
      }

      const result = { scanned: candidates.length, enqueued, skipped, failed, skippedRun: false };
      this.pino.info(result, 'vessel enrichment reconciliation complete');
      return result;
    } finally {
      this.inFlight = false;
    }
  }
}
