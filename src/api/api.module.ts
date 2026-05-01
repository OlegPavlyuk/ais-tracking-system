import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { SanctionsCoreModule } from '../enrichment/sanctions/sanctions-core.module';
import { VesselsController } from './vessels.controller';
import { SanctionsController } from './sanctions.controller';

@Module({
  imports: [StorageModule, SanctionsCoreModule],
  controllers: [VesselsController, SanctionsController],
})
export class ApiModule {}
