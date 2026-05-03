import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SANCTIONS_IMPORT_QUEUE, SanctionsImportJobData } from './sanctions.processor';

@Injectable()
export class SanctionsImportCommandService {
  constructor(
    @InjectQueue(SANCTIONS_IMPORT_QUEUE)
    private readonly queue: Queue<SanctionsImportJobData>,
  ) {}

  async requestRun(source: SanctionsImportJobData['source']): Promise<{ jobId: string }> {
    const job = await this.queue.add(
      `${source}.manual`,
      { source },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    return { jobId: String(job.id) };
  }
}
