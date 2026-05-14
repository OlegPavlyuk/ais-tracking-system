import { DynamicModule, Module, Type } from '@nestjs/common';
import { ConfigModule } from './shared/config/config.module';
import { LoggerModule } from './shared/logger/logger.module';
import { MetricsModule } from './shared/metrics/metrics.module';
import { DbModule } from './shared/db/db.module';
import { RedisModule } from './shared/redis/redis.module';
import { BusModule } from './shared/bus/bus.module';
import { QueueModule } from './shared/queue/queue.module';
import { HealthModule } from './shared/health/health.module';
import { ApiModule } from './api/api.module';
import { AdminModule } from './admin/admin.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { StorageModule } from './storage/storage.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ProcessRole } from './shared/config/env.schema';

type NestImport = Type<unknown> | DynamicModule;

const SHARED: NestImport[] = [
  ConfigModule,
  LoggerModule,
  MetricsModule,
  DbModule,
  RedisModule,
  BusModule,
  QueueModule,
  HealthModule,
];

const ROLE_MODULES: Record<ProcessRole, NestImport[]> = {
  all: [
    ApiModule,
    AdminModule,
    IngestionModule,
    PipelineModule,
    StorageModule,
    EnrichmentModule,
    RealtimeModule,
  ],
  api: [ApiModule, AdminModule, RealtimeModule],
  ingestion: [IngestionModule, PipelineModule, StorageModule],
  worker: [EnrichmentModule],
};

@Module({})
export class AppModule {
  static forRole(role: ProcessRole): DynamicModule {
    return {
      module: AppModule,
      imports: [...SHARED, ...ROLE_MODULES[role]],
    };
  }
}
