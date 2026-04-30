import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { ConfigModule } from '../shared/config/config.module';
import { AisStreamNormalizer } from './normalizer';
import { IngestionPipelineService } from './ingestion-pipeline.service';
import { DedupService } from './dedup.service';
import { SamplerService } from './sampler.service';

@Module({
  imports: [IngestionModule, ConfigModule],
  providers: [AisStreamNormalizer, IngestionPipelineService, DedupService, SamplerService],
  exports: [AisStreamNormalizer, DedupService, SamplerService],
})
export class PipelineModule {}
