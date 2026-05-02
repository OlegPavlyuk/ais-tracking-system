import { Module } from '@nestjs/common';
import { SanctionsModule } from './sanctions/sanctions.module';
import { VesselEnrichmentModule } from './vessel/vessel-enrichment.module';

@Module({
  imports: [SanctionsModule, VesselEnrichmentModule],
  exports: [SanctionsModule, VesselEnrichmentModule],
})
export class EnrichmentModule {}
