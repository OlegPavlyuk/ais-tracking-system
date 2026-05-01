import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '../../shared/config/config.service';
import { ConfigModule } from '../../shared/config/config.module';
import { SanctionsCoreModule } from './sanctions-core.module';
import { SanctionsImporterService } from './sanctions-importer.service';
import { SanctionsImportProcessor, SANCTIONS_IMPORT_QUEUE } from './sanctions.processor';
import { SanctionsScheduler } from './sanctions.scheduler';

@Module({
  imports: [
    ConfigModule,
    SanctionsCoreModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get('REDIS_URL'),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({ name: SANCTIONS_IMPORT_QUEUE }),
  ],
  providers: [SanctionsImporterService, SanctionsImportProcessor, SanctionsScheduler],
  exports: [SanctionsCoreModule, SanctionsScheduler],
})
export class SanctionsModule {}
