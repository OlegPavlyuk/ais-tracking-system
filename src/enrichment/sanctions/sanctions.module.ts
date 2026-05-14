import { Module } from '@nestjs/common';
import { ConfigModule } from '../../shared/config/config.module';
import { SanctionsCoreModule } from './sanctions-core.module';
import { SanctionsImportLifecycleService } from './sanctions-import-lifecycle.service';
import { SanctionsImportQueueModule } from './sanctions-import-queue.module';
import { SanctionsImporterService } from './sanctions-importer.service';
import { SanctionsImportProcessor } from './sanctions.processor';
import { SanctionsScheduler } from './sanctions.scheduler';

@Module({
  imports: [ConfigModule, SanctionsCoreModule, SanctionsImportQueueModule],
  providers: [
    SanctionsImporterService,
    SanctionsImportProcessor,
    SanctionsScheduler,
    SanctionsImportLifecycleService,
  ],
  exports: [SanctionsCoreModule, SanctionsScheduler],
})
export class SanctionsModule {}
