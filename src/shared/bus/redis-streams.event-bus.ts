import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { EventBus, EventBusHandler } from './event-bus';

/**
 * Stub Redis Streams implementation. Wired into DI in Slice #1; consumer-group
 * fan-out and XAUTOCLAIM recovery land in later slices.
 */
@Injectable()
export class RedisStreamsEventBus implements EventBus {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async publish<T>(stream: string, payload: T): Promise<string> {
    const id = await this.redis.client.xadd(
      stream,
      '*',
      'data',
      JSON.stringify(payload),
    );
    if (!id) throw new Error(`XADD to ${stream} returned no id`);
    return id;
  }

  async subscribe<T>(
    _stream: string,
    _group: string,
    _consumer: string,
    _handler: EventBusHandler<T>,
  ): Promise<void> {
    throw new Error('RedisStreamsEventBus.subscribe is not implemented in Slice #1');
  }
}
