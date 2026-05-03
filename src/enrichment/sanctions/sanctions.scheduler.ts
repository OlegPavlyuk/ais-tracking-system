import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '../../shared/config/config.service';
import { SANCTIONS_IMPORT_QUEUE, SanctionsImportJobData } from './sanctions.processor';

@Injectable()
export class SanctionsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SanctionsScheduler.name);

  constructor(
    @InjectQueue(SANCTIONS_IMPORT_QUEUE)
    private readonly queue: Queue<SanctionsImportJobData>,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const cron = this.config.get('SANCTIONS_IMPORT_CRON');
    await this.queue.add(
      'ofac',
      { source: 'ofac' },
      {
        repeat: { pattern: cron },
        jobId: 'sanctions.import:ofac:scheduled',
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    this.logger.log(`scheduled sanctions.import ofac with cron="${cron}"`);
  }

}
