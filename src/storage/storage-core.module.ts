import { Module } from '@nestjs/common';
import { VesselsRepository } from './vessels.repository';

@Module({
  providers: [VesselsRepository],
  exports: [VesselsRepository],
})
export class StorageCoreModule {}
