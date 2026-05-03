import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';
import { RedisService } from '../redis/redis.service';
import { AIS_DEADLETTER_STREAM } from '../config/constants';
import { EventBus, EventBusHandler } from './event-bus';
import { FailureHandler, serializeError } from './failure-handler';

interface ConsumerLoop {
  stream: string;
  group: string;
  consumer: string;
  handler: EventBusHandler;
  client: Redis;
  stopped: boolean;
  autoclaimCursor: string;
  autoclaimInFlight: boolean;
  autoclaimTimer?: NodeJS.Timeout;
}

@Injectable()
export class RedisStreamsEventBus implements EventBus, OnModuleDestroy {
  private readonly logger = new Logger(RedisStreamsEventBus.name);
  private readonly loops: ConsumerLoop[] = [];
  private readonly subscribers: Redis[] = [];
  private readonly registered = new Set<string>();

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(FailureHandler) private readonly failures: FailureHandler,
  ) {}

  async publish<T>(stream: string, payload: T): Promise<string> {
    const maxLen = this.config.get('STREAM_MAXLEN');
    const id = await this.redis.client.xadd(
      stream,
      'MAXLEN',
      '~',
      String(maxLen),
      '*',
      'data',
      JSON.stringify(payload),
    );
    if (!id) throw new Error(`XADD to ${stream} returned no id`);
    return id;
  }

  async subscribe<T>(
    stream: string,
    group: string,
    consumer: string,
    handler: EventBusHandler<T>,
  ): Promise<void> {
    const key = `${stream}|${group}|${consumer}`;
    if (this.registered.has(key)) {
      this.logger.warn(`subscribe() called twice for ${key}; ignoring duplicate`);
      return;
    }
    this.registered.add(key);

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
      autoclaimCursor: '0-0',
      autoclaimInFlight: false,
    };
    this.loops.push(loop);
    this.runLoop(loop).catch((err) => {
      this.logger.error(
        `consumer loop crashed: stream=${stream} group=${group} consumer=${consumer}: ${(err as Error).message}`,
      );
    });
    this.startAutoClaim(loop);
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

  private startAutoClaim(loop: ConsumerLoop): void {
    const interval = this.config.get('STREAM_AUTOCLAIM_INTERVAL_MS');
    loop.autoclaimTimer = setInterval(() => {
      if (loop.stopped || loop.autoclaimInFlight) return;
      loop.autoclaimInFlight = true;
      this.autoClaimTick(loop)
        .catch((err) =>
          this.logger.warn(
            `autoclaim error stream=${loop.stream} group=${loop.group}: ${(err as Error).message}`,
          ),
        )
        .finally(() => {
          loop.autoclaimInFlight = false;
        });
    }, interval);
    // Don't keep the event loop alive solely for autoclaim during tests.
    loop.autoclaimTimer.unref?.();
  }

  private async autoClaimTick(loop: ConsumerLoop): Promise<void> {
    const minIdle = this.config.get('STREAM_PENDING_CLAIM_IDLE_MS');
    const reply = (await loop.client.xautoclaim(
      loop.stream,
      loop.group,
      loop.consumer,
      minIdle,
      loop.autoclaimCursor,
      'COUNT',
      50,
    )) as [string, [string, string[]][]] | null;
    if (!reply) return;
    const [nextCursor, entries] = reply;
    loop.autoclaimCursor = nextCursor === '0-0' ? '0-0' : nextCursor;
    for (const [id, fields] of entries) {
      if (loop.stopped) return;
      await this.dispatch(loop, id, fields);
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
      await this.deadletterMalformed(loop, id, dataValue, err);
      return;
    }
    let action: Awaited<ReturnType<FailureHandler['onHandlerError']>> | null = null;
    try {
      await loop.handler({ id, payload });
      await loop.client.xack(loop.stream, loop.group, id);
      return;
    } catch (handlerErr) {
      try {
        action = await this.failures.onHandlerError({
          stream: loop.stream,
          group: loop.group,
          messageId: id,
          payload,
          error: handlerErr,
        });
      } catch (failureErr) {
        this.logger.error(
          `FailureHandler failed; leaving message pending stream=${loop.stream} group=${loop.group} id=${id}: ${(failureErr as Error).message}`,
        );
        return;
      }
    }
    if (action && action.action === 'deadletter-and-ack') {
      await loop.client.xack(loop.stream, loop.group, id);
    }
  }

  private async deadletterMalformed(
    loop: ConsumerLoop,
    id: string,
    rawData: string,
    parseError: unknown,
  ): Promise<void> {
    const now = new Date().toISOString();
    const dlqPayload = {
      originalMessageId: id,
      originalStream: loop.stream,
      consumerGroup: loop.group,
      originalRawData: rawData,
      attempts: 1,
      firstFailedAt: now,
      lastFailedAt: now,
      error: serializeError(parseError),
      reason: 'invalid-json',
    };
    const maxLen = this.config.get('STREAM_MAXLEN');
    try {
      await this.redis.client.xadd(
        AIS_DEADLETTER_STREAM,
        'MAXLEN',
        '~',
        String(maxLen),
        '*',
        'data',
        JSON.stringify(dlqPayload),
      );
      this.logger.error(
        `DLQ invalid-json stream=${loop.stream} group=${loop.group} id=${id}: ${dlqPayload.error.message}`,
      );
      await loop.client.xack(loop.stream, loop.group, id);
    } catch (dlqErr) {
      this.logger.error(
        `failed to DLQ malformed message; leaving pending stream=${loop.stream} group=${loop.group} id=${id}: ${(dlqErr as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const loop of this.loops) {
      loop.stopped = true;
      if (loop.autoclaimTimer) clearInterval(loop.autoclaimTimer);
    }
    for (const sub of this.subscribers) sub.disconnect();
  }
}
