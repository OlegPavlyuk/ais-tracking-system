import { Module } from '@nestjs/common';
import { SanctionsModule } from './sanctions/sanctions.module';

@Module({
  imports: [SanctionsModule],
  exports: [SanctionsModule],
})
export class EnrichmentModule {}
