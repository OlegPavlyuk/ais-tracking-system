import { Module } from '@nestjs/common';
import { StorageCoreModule } from './storage-core.module';
import { HistoryPartitionMaintenanceService } from './history-partition-maintenance.service';
import { StorageWriterConsumer } from './storage-writer.consumer';

@Module({
  imports: [StorageCoreModule],
  providers: [StorageWriterConsumer, HistoryPartitionMaintenanceService],
  exports: [StorageCoreModule],
})
export class StorageModule {}
