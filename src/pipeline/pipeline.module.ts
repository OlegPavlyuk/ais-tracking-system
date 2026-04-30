import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AisStreamNormalizer } from './normalizer';
import { IngestionPipelineService } from './ingestion-pipeline.service';

@Module({
  imports: [IngestionModule],
  providers: [AisStreamNormalizer, IngestionPipelineService],
  exports: [AisStreamNormalizer],
})
export class PipelineModule {}
