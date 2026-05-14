import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SanctionsImportCommandService } from './sanctions-import-command.service';
import { SanctionsRepository } from './sanctions.repository';
import { SANCTIONS_SOURCE_REGISTRY, SanctionsSourceId } from './source-registry';

@Injectable()
export class SanctionsImportLifecycleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SanctionsImportLifecycleService.name);

  constructor(
    @Inject(SanctionsRepository) private readonly repo: SanctionsRepository,
    @Inject(SanctionsImportCommandService)
    private readonly commands: SanctionsImportCommandService,
  ) {}

  onApplicationBootstrap(): void {
    for (const source of SANCTIONS_SOURCE_REGISTRY) {
      void this.bootstrapSource(source.id);
    }
  }

  private async bootstrapSource(source: SanctionsSourceId): Promise<void> {
    try {
      const hasSuccessfulRun = await this.repo.hasSuccessfulRunBySource(source);
      if (hasSuccessfulRun) {
        this.logger.log(`sanctions bootstrap skipped source=${source} reason=successful-run-exists`);
        return;
      }

      const { jobId } = await this.commands.requestBootstrapRun(source);
      this.logger.log(`sanctions bootstrap enqueued source=${source} job=${jobId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`sanctions bootstrap failed source=${source}: ${message}`);
    }
  }
}
