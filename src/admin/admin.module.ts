import { Module } from '@nestjs/common';
import { SanctionsCoreModule } from '../enrichment/sanctions/sanctions-core.module';
import { SanctionsImportQueueModule } from '../enrichment/sanctions/sanctions-import-queue.module';
import { ConfigModule } from '../shared/config/config.module';
import { RedisModule } from '../shared/redis/redis.module';
import { AdminTokenGuard } from './admin-token.guard';
import { DeadletterController } from './deadletter.controller';
import { SanctionsAdminController } from './sanctions-admin.controller';
import { StreamsAdminController } from './streams-admin.controller';

@Module({
  imports: [ConfigModule, RedisModule, SanctionsCoreModule, SanctionsImportQueueModule],
  providers: [AdminTokenGuard],
  controllers: [DeadletterController, SanctionsAdminController, StreamsAdminController],
})
export class AdminModule {}
