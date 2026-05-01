import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../shared/config/config.service';
import { SanctionsRepository } from './sanctions.repository';
import { SanctionsSourceAdapter, VesselEntity } from './sanctions-source.adapter';

export interface ImportResult {
  runId: number;
  status: 'completed' | 'failed';
  recordsImported: number;
  errors: unknown[];
}

@Injectable()
export class SanctionsImporterService {
  private readonly logger = new Logger(SanctionsImporterService.name);

  constructor(
    @Inject(SanctionsRepository) private readonly repo: SanctionsRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async run(adapter: SanctionsSourceAdapter): Promise<ImportResult> {
    const batchSize = this.config.get('SANCTIONS_IMPORT_BATCH_SIZE');
    const runId = await this.repo.startRun(adapter.source);
    this.logger.log(`sanctions import started source=${adapter.source} run=${runId}`);
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
      this.logger.log(`sanctions import completed source=${adapter.source} run=${runId} records=${count}`);
      return { runId, status: 'completed', recordsImported: count, errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ message });
      await this.repo.finishRun(runId, 'failed', count, errors);
      this.logger.error(`sanctions import failed source=${adapter.source} run=${runId}: ${message}`);
      throw err;
    }
  }
}
