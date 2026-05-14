import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SANCTIONS_IMPORT_QUEUE, SanctionsImportJobData } from './sanctions.processor';

const RETAIN_RECENT_JOBS = 100;

@Injectable()
export class SanctionsImportCommandService {
  constructor(
    @InjectQueue(SANCTIONS_IMPORT_QUEUE)
    private readonly queue: Queue<SanctionsImportJobData>,
  ) {}

  async requestManualRun(source: SanctionsImportJobData['source']): Promise<{ jobId: string }> {
    const job = await this.queue.add(
      `${source}.manual`,
      { source },
      { removeOnComplete: RETAIN_RECENT_JOBS, removeOnFail: RETAIN_RECENT_JOBS },
    );
    return { jobId: String(job.id) };
  }

  async requestBootstrapRun(source: SanctionsImportJobData['source']): Promise<{ jobId: string }> {
    const jobId = `sanctions.import:${source}:bootstrap`;
    const job = await this.queue.add(
      `${source}.bootstrap`,
      { source },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return { jobId: String(job.id ?? jobId) };
  }

  async requestRun(source: SanctionsImportJobData['source']): Promise<{ jobId: string }> {
    return this.requestManualRun(source);
  }
}
