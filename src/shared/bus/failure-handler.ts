import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { AIS_DEADLETTER_STREAM } from '../config/constants';
import { RedisService } from '../redis/redis.service';

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

const STACK_MAX_BYTES = 2048;

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const stack = typeof err.stack === 'string' ? err.stack.slice(0, STACK_MAX_BYTES) : undefined;
    return { name: err.name || 'Error', message: err.message, ...(stack ? { stack } : {}) };
  }
  let message: string;
  try {
    message = String(err);
  } catch {
    message = '[unserializable error]';
  }
  return { name: 'NonError', message };
}

export interface OnHandlerErrorArgs {
  stream: string;
  group: string;
  messageId: string;
  payload: unknown;
  error: unknown;
}

export type FailureAction =
  | { action: 'leave-unacked'; attempts: number }
  | { action: 'deadletter-and-ack'; attempts: number; deadletterId: string };

const COUNTER_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class FailureHandler {
  private readonly logger = new Logger(FailureHandler.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async onHandlerError(args: OnHandlerErrorArgs): Promise<FailureAction> {
    const { stream, group, messageId, payload, error } = args;
    const limit = this.config.get('STREAM_RETRY_LIMIT');
    const counterKey = `dlq:retry:${encodeURIComponent(stream)}:${encodeURIComponent(group)}:${messageId}`;
    const now = new Date().toISOString();

    const client = this.redis.client;
    const attempts = await client.hincrby(counterKey, 'attempts', 1);
    await client.hsetnx(counterKey, 'firstFailedAt', now);
    await client.hset(counterKey, 'lastFailedAt', now);
    await client.expire(counterKey, COUNTER_TTL_SECONDS);

    const serialized = serializeError(error);
    if (attempts < limit) {
      this.logger.warn(
        `handler error stream=${stream} group=${group} id=${messageId} attempts=${attempts}/${limit}: ${serialized.message}`,
      );
      return { action: 'leave-unacked', attempts };
    }

    const meta = await client.hgetall(counterKey);
    const firstFailedAt = meta.firstFailedAt || now;
    const lastFailedAt = meta.lastFailedAt || now;

    const dlqPayload = {
      originalMessageId: messageId,
      originalStream: stream,
      consumerGroup: group,
      originalEvent: payload,
      attempts,
      firstFailedAt,
      lastFailedAt,
      error: serialized,
    };

    const maxLen = this.config.get('STREAM_MAXLEN');
    const deadletterId = await client.xadd(
      AIS_DEADLETTER_STREAM,
      'MAXLEN',
      '~',
      String(maxLen),
      '*',
      'data',
      JSON.stringify(dlqPayload),
    );
    await client.del(counterKey);

    const obj = (typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const kind = typeof obj.kind === 'string' ? (obj.kind as string) : 'unknown';
    const mmsi =
      typeof obj.mmsi === 'string'
        ? obj.mmsi
        : typeof obj.mmsi === 'number' && Number.isFinite(obj.mmsi)
          ? String(obj.mmsi)
          : 'unknown';
    this.logger.error(
      `DLQ stream=${stream} group=${group} id=${messageId} reason=${serialized.message} attempts=${attempts} kind=${kind} mmsi=${mmsi}`,
    );

    return { action: 'deadletter-and-ack', attempts, deadletterId: String(deadletterId ?? '') };
  }
}

