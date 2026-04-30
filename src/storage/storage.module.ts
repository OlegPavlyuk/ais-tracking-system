import { Module } from '@nestjs/common';
import { VesselsRepository } from './vessels.repository';
import { StorageWriterConsumer } from './storage-writer.consumer';

@Module({
  providers: [VesselsRepository, StorageWriterConsumer],
  exports: [VesselsRepository],
})
export class StorageModule {}
