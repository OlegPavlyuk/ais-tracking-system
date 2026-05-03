import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SanctionsImportCommandService } from './sanctions-import-command.service';
import { SANCTIONS_IMPORT_QUEUE } from './sanctions.processor';

@Module({
  imports: [BullModule.registerQueue({ name: SANCTIONS_IMPORT_QUEUE })],
  providers: [SanctionsImportCommandService],
  exports: [SanctionsImportCommandService, BullModule],
})
export class SanctionsImportQueueModule {}
