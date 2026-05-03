import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { RedisModule } from '../redis/redis.module';
import { EVENT_BUS } from './event-bus';
import { FailureHandler } from './failure-handler';
import { RedisStreamsEventBus } from './redis-streams.event-bus';

@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    FailureHandler,
    RedisStreamsEventBus,
    { provide: EVENT_BUS, useExisting: RedisStreamsEventBus },
  ],
  exports: [EVENT_BUS, FailureHandler],
})
export class BusModule {}
