import { Module } from '@nestjs/common';
import { StorageCoreModule } from '../storage/storage-core.module';
import { SanctionsCoreModule } from '../enrichment/sanctions/sanctions-core.module';
import { VesselsController } from './vessels.controller';
import { SanctionsController } from './sanctions.controller';

@Module({
  imports: [StorageCoreModule, SanctionsCoreModule],
  controllers: [VesselsController, SanctionsController],
})
export class ApiModule {}
