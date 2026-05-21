import { Module } from '@nestjs/common';
import { ConfigModule } from '../shared/config/config.module';
import { DbModule } from '../shared/db/db.module';
import { RedisModule } from '../shared/redis/redis.module';
import { GeoValidationService } from './geo-validation.service';

@Module({
  imports: [ConfigModule, DbModule, RedisModule],
  providers: [GeoValidationService],
  exports: [GeoValidationService],
})
export class GeoModule {}
