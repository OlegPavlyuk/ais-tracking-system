import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '../../shared/config/config.service';
import { OfacAdapter } from './ofac.adapter';
import { SanctionsImporterService } from './sanctions-importer.service';
import { SanctionsSourceAdapter } from './sanctions-source.adapter';

export const SANCTIONS_IMPORT_QUEUE = 'sanctions.import';

export interface SanctionsImportJobData {
  source: 'ofac';
}

@Processor(SANCTIONS_IMPORT_QUEUE)
export class SanctionsImportProcessor extends WorkerHost {
  private readonly logger = new Logger(SanctionsImportProcessor.name);

  constructor(
    @Inject(SanctionsImporterService) private readonly importer: SanctionsImporterService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<SanctionsImportJobData>): Promise<{ recordsImported: number }> {
    const adapter = this.adapterFor(job.data.source);
    this.logger.log(`processing job=${job.id} source=${job.data.source}`);
    const result = await this.importer.run(adapter);
    return { recordsImported: result.recordsImported };
  }

  private adapterFor(source: SanctionsImportJobData['source']): SanctionsSourceAdapter {
    if (source === 'ofac') {
      const fixturePath = this.config.get('OFAC_SDN_FIXTURE_PATH');
      if (fixturePath) return OfacAdapter.fromFile(fixturePath);
      return OfacAdapter.fromUrl(this.config.get('OFAC_SDN_URL'));
    }
    throw new Error(`unknown sanctions source: ${source}`);
  }
}
