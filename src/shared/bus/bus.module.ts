import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { EVENT_BUS } from './event-bus';
import { RedisStreamsEventBus } from './redis-streams.event-bus';

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    RedisStreamsEventBus,
    { provide: EVENT_BUS, useExisting: RedisStreamsEventBus },
  ],
  exports: [EVENT_BUS],
})
export class BusModule {}
