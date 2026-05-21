import { Module } from '@nestjs/common';
import { ConfigModule } from '../shared/config/config.module';
import { DbModule } from '../shared/db/db.module';
import { MetricsModule } from '../shared/metrics/metrics.module';
import { RedisModule } from '../shared/redis/redis.module';
import { GeoCacheService } from './geo-cache.service';
import { GeoDatasetRepository } from './geo-dataset.repository';
import { GeoValidationService } from './geo-validation.service';

@Module({
  imports: [ConfigModule, DbModule, RedisModule, MetricsModule],
  providers: [GeoValidationService, GeoDatasetRepository, GeoCacheService],
  exports: [GeoValidationService],
})
export class GeoModule {}
