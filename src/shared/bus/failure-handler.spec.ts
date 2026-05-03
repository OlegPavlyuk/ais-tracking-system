import { FailureHandler, serializeError } from './failure-handler';
import { AIS_DEADLETTER_STREAM } from '../config/constants';
import type { ConfigService } from '../config/config.service';
import type { RedisService } from '../redis/redis.service';

const RETRY_LIMIT = 3;
const STREAM_MAXLEN = 100_000;
const STREAM = 'ais.events.v1';
const GROUP = 'storage-writer';

interface RedisMock {
  hincrby: jest.Mock;
  hsetnx: jest.Mock;
  hset: jest.Mock;
  hgetall: jest.Mock;
  expire: jest.Mock;
  del: jest.Mock;
  xadd: jest.Mock;
}

function makeRedis(initialAttempts = 0, initialFirst?: string): RedisMock {
  let attempts = initialAttempts;
  let firstFailedAt: string | undefined = initialFirst;
  let lastFailedAt: string | undefined;
  return {
    hincrby: jest.fn(async (_key: string, _field: string, n: number) => {
      attempts += n;
      return attempts;
    }),
    hsetnx: jest.fn(async (_key: string, _field: string, value: string) => {
      if (firstFailedAt === undefined) {
        firstFailedAt = value;
        return 1;
      }
      return 0;
    }),
    hset: jest.fn(async (_key: string, _field: string, value: string) => {
      lastFailedAt = value;
      return 1;
    }),
    hgetall: jest.fn(async () => ({
      attempts: String(attempts),
      firstFailedAt: firstFailedAt ?? '',
      lastFailedAt: lastFailedAt ?? '',
    })),
    expire: jest.fn(async () => 1),
    del: jest.fn(async () => 1),
    xadd: jest.fn(async () => 'dlq-1-0'),
  };
}

function makeConfig(): ConfigService {
  return {
    get: jest.fn((k: string) => {
      if (k === 'STREAM_RETRY_LIMIT') return RETRY_LIMIT;
      if (k === 'STREAM_MAXLEN') return STREAM_MAXLEN;
      throw new Error(`unexpected key ${k}`);
    }),
  } as unknown as ConfigService;
}

function makeHandler(redis: RedisMock): FailureHandler {
  const redisService = { client: redis } as unknown as RedisService;
  return new FailureHandler(redisService, makeConfig());
}

describe('FailureHandler', () => {
  it('on first failure: increments counter, leaves message unacked', async () => {
    const redis = makeRedis(0);
    const handler = makeHandler(redis);
    const action = await handler.onHandlerError({
      stream: STREAM,
      group: GROUP,
      messageId: '17-0',
      payload: { kind: 'position', mmsi: '241935000' },
      error: new Error('db down'),
    });
    expect(action).toEqual({ action: 'leave-unacked', attempts: 1 });
    expect(redis.hincrby).toHaveBeenCalledWith(
      `dlq:retry:${STREAM}:${GROUP}:17-0`,
      'attempts',
      1,
    );
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('on Nth failure: publishes DLQ entry then asks bus to ACK; clears counter', async () => {
    const redis = makeRedis(RETRY_LIMIT - 1, '2026-05-03T10:00:00.000Z');
    const handler = makeHandler(redis);
    const action = await handler.onHandlerError({
      stream: STREAM,
      group: GROUP,
      messageId: '17-0',
      payload: { kind: 'position', mmsi: '241935000', schemaVersion: 1 },
      error: Object.assign(new Error('boom'), { stack: 'Error: boom\n  at x' }),
    });
    expect(action.action).toBe('deadletter-and-ack');
    expect(redis.xadd).toHaveBeenCalledTimes(1);
    const xaddArgs = redis.xadd.mock.calls[0]!;
    expect(xaddArgs[0]).toBe(AIS_DEADLETTER_STREAM);
    expect(xaddArgs[1]).toBe('MAXLEN');
    expect(xaddArgs[2]).toBe('~');
    expect(xaddArgs[3]).toBe(String(STREAM_MAXLEN));
    expect(xaddArgs[4]).toBe('*');
    expect(xaddArgs[5]).toBe('data');
    const payload = JSON.parse(xaddArgs[6] as string);
    expect(payload).toMatchObject({
      originalMessageId: '17-0',
      originalStream: STREAM,
      consumerGroup: GROUP,
      originalEvent: { kind: 'position', mmsi: '241935000', schemaVersion: 1 },
      attempts: RETRY_LIMIT,
      firstFailedAt: '2026-05-03T10:00:00.000Z',
      error: { name: 'Error', message: 'boom' },
    });
    expect(payload.error.stack).toContain('Error: boom');
    expect(typeof payload.lastFailedAt).toBe('string');
    expect(redis.del).toHaveBeenCalledWith(`dlq:retry:${STREAM}:${GROUP}:17-0`);
  });

  it('serialises non-Error rejections without leaking secrets', () => {
    const out = serializeError({ password: 'secret', toString: () => 'oops' } as unknown);
    expect(out.name).toBe('NonError');
    expect(out.message).toBe('oops');
    expect((out as unknown as Record<string, unknown>).password).toBeUndefined();
  });

  it('truncates very long stack traces', () => {
    const big = 'X'.repeat(10_000);
    const out = serializeError(Object.assign(new Error('e'), { stack: big }));
    expect(out.stack!.length).toBeLessThanOrEqual(2048);
  });
});
