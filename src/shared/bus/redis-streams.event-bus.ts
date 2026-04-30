import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import { EventBus, EventBusHandler } from './event-bus';

interface ConsumerLoop {
  stream: string;
  group: string;
  consumer: string;
  handler: EventBusHandler;
  client: Redis;
  stopped: boolean;
}

@Injectable()
export class RedisStreamsEventBus implements EventBus, OnModuleDestroy {
  private readonly logger = new Logger(RedisStreamsEventBus.name);
  private readonly loops: ConsumerLoop[] = [];
  private readonly subscribers: Redis[] = [];

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async publish<T>(stream: string, payload: T): Promise<string> {
    const id = await this.redis.client.xadd(stream, '*', 'data', JSON.stringify(payload));
    if (!id) throw new Error(`XADD to ${stream} returned no id`);
    return id;
  }

  async subscribe<T>(
    stream: string,
    group: string,
    consumer: string,
    handler: EventBusHandler<T>,
  ): Promise<void> {
    await this.ensureGroup(stream, group);

    // Dedicated client for this consumer — XREADGROUP blocks the connection.
    const client = this.redis.client.duplicate();
    this.subscribers.push(client);

    const loop: ConsumerLoop = {
      stream,
      group,
      consumer,
      handler: handler as EventBusHandler,
      client,
      stopped: false,
    };
    this.loops.push(loop);
    this.runLoop(loop).catch((err) => {
      this.logger.error(
        `consumer loop crashed: stream=${stream} group=${group} consumer=${consumer}: ${(err as Error).message}`,
      );
    });
  }

  private async ensureGroup(stream: string, group: string): Promise<void> {
    try {
      await this.redis.client.xgroup('CREATE', stream, group, '$', 'MKSTREAM');
      this.logger.log(`created consumer group ${group} on ${stream}`);
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.includes('BUSYGROUP')) throw err;
    }
  }

  private async runLoop(loop: ConsumerLoop): Promise<void> {
    while (!loop.stopped) {
      let res: [string, [string, string[]][]][] | null = null;
      try {
        res = (await loop.client.xreadgroup(
          'GROUP',
          loop.group,
          loop.consumer,
          'COUNT',
          10,
          'BLOCK',
          5000,
          'STREAMS',
          loop.stream,
          '>',
        )) as [string, [string, string[]][]][] | null;
      } catch (err) {
        if (loop.stopped) return;
        this.logger.warn(
          `xreadgroup error stream=${loop.stream} group=${loop.group}: ${(err as Error).message}`,
        );
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      if (!res) continue;
      for (const [, entries] of res) {
        for (const [id, fields] of entries) {
          await this.dispatch(loop, id, fields);
        }
      }
    }
  }

  private async dispatch(loop: ConsumerLoop, id: string, fields: string[]): Promise<void> {
    const dataIdx = fields.indexOf('data');
    if (dataIdx === -1) {
      this.logger.warn(`stream message ${id} missing 'data' field; ACK and skip`);
      await loop.client.xack(loop.stream, loop.group, id);
      return;
    }
    const dataValue = fields[dataIdx + 1];
    if (dataValue === undefined) {
      this.logger.warn(`stream message ${id} 'data' field empty; ACK and skip`);
      await loop.client.xack(loop.stream, loop.group, id);
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(dataValue);
    } catch (err) {
      this.logger.warn(`stream message ${id} invalid JSON; ACK and skip: ${(err as Error).message}`);
      await loop.client.xack(loop.stream, loop.group, id);
      return;
    }
    try {
      await loop.handler({ id, payload });
      await loop.client.xack(loop.stream, loop.group, id);
    } catch (err) {
      // Slice #2: log and leave unacked. Retry/DLQ lands in slice #10.
      this.logger.error(
        `handler error stream=${loop.stream} group=${loop.group} id=${id}: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const loop of this.loops) loop.stopped = true;
    for (const sub of this.subscribers) sub.disconnect();
  }
}
