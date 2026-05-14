import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { ConfigService } from '../../shared/config/config.service';
import {
  SANCTIONS_IMPORT_DURATION_SECONDS,
  SANCTIONS_IMPORT_RECORDS_TOTAL,
} from '../../shared/metrics/metric-names';
import { SanctionsRepository } from './sanctions.repository';
import { SanctionsSourceAdapter, VesselEntity } from './sanctions-source.adapter';

export interface ImportResult {
  runId: number | null;
  status: 'completed' | 'failed' | 'skipped';
  recordsImported: number;
  errors: unknown[];
}

@Injectable()
export class SanctionsImporterService {
  private readonly logger = new Logger(SanctionsImporterService.name);

  constructor(
    @Inject(SanctionsRepository) private readonly repo: SanctionsRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectMetric(SANCTIONS_IMPORT_DURATION_SECONDS)
    private readonly importDuration: Histogram<'source'>,
    @InjectMetric(SANCTIONS_IMPORT_RECORDS_TOTAL)
    private readonly importRecords: Counter<'source'>,
  ) {}

  async run(adapter: SanctionsSourceAdapter): Promise<ImportResult> {
    const lockResult = await this.repo.withSourceImportLock(adapter.source, () =>
      this.runWithLock(adapter),
    );
    if (!lockResult.acquired) {
      this.logger.warn(`sanctions import skipped source=${adapter.source} reason=lock-held`);
      return { runId: null, status: 'skipped', recordsImported: 0, errors: [] };
    }
    return lockResult.result;
  }

  private async runWithLock(adapter: SanctionsSourceAdapter): Promise<ImportResult> {
    const batchSize = this.config.get('SANCTIONS_IMPORT_BATCH_SIZE');
    const runId = await this.repo.startRun(adapter.source);
    this.logger.log(`sanctions import started source=${adapter.source} run=${runId}`);
    const endTimer = this.importDuration.startTimer({ source: adapter.source });
    const errors: unknown[] = [];
    let count = 0;
    let batch: VesselEntity[] = [];
    try {
      for await (const entity of adapter.fetchAll()) {
        batch.push(entity);
        if (batch.length >= batchSize) {
          await this.repo.upsertEntities(adapter.source, batch);
          count += batch.length;
          batch = [];
        }
      }
      if (batch.length > 0) {
        await this.repo.upsertEntities(adapter.source, batch);
        count += batch.length;
      }
      await this.repo.finishRun(runId, 'completed', count, errors);
      if (count > 0) this.importRecords.inc({ source: adapter.source }, count);
      this.logger.log(`sanctions import completed source=${adapter.source} run=${runId} records=${count}`);
      return { runId, status: 'completed', recordsImported: count, errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ message });
      await this.markRunFailed(runId, adapter.source, count, errors);
      this.logger.error(`sanctions import failed source=${adapter.source} run=${runId}: ${message}`);
      throw err;
    } finally {
      endTimer();
    }
  }

  private async markRunFailed(
    runId: number,
    source: string,
    recordsImported: number,
    errors: unknown[],
  ): Promise<void> {
    try {
      await this.repo.finishRun(runId, 'failed', recordsImported, errors);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `sanctions import failed to mark run as failed source=${source} run=${runId}: ${message}`,
      );
    }
  }
}
