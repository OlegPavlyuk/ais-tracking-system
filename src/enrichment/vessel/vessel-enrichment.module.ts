import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BusModule } from '../../shared/bus/bus.module';
import { ConfigModule } from '../../shared/config/config.module';
import { ConfigService } from '../../shared/config/config.service';
import { DbModule } from '../../shared/db/db.module';
import { RedisModule } from '../../shared/redis/redis.module';
import {
  ENRICHMENT_VESSEL_QUEUE,
  EnrichmentDispatcher,
  enrichmentRedisProvider,
} from './enrichment-dispatcher';
import { EnrichmentProcessor } from './enrichment.processor';
import { EnrichmentRepository } from './enrichment.repository';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    BusModule,
    BullModule.registerQueueAsync({
      name: ENRICHMENT_VESSEL_QUEUE,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        defaultJobOptions: {
          attempts: config.get('ENRICHMENT_JOB_ATTEMPTS'),
          backoff: { type: 'exponential', delay: config.get('ENRICHMENT_JOB_BACKOFF_MS') },
          removeOnComplete: 200,
          removeOnFail: 200,
        },
      }),
    }),
  ],
  providers: [EnrichmentRepository, enrichmentRedisProvider, EnrichmentDispatcher, EnrichmentProcessor],
  exports: [EnrichmentRepository],
})
export class VesselEnrichmentModule {}
