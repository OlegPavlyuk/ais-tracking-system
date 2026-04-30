import { Module } from '@nestjs/common';
import { AisStreamAdapter } from './aisstream.adapter';
import { RawFilter } from './raw-filter';

@Module({
  providers: [AisStreamAdapter, RawFilter],
  exports: [AisStreamAdapter, RawFilter],
})
export class IngestionModule {}
