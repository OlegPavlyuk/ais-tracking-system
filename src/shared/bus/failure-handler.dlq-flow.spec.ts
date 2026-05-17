import { Logger } from '@nestjs/common';
import { FailureHandler } from './failure-handler';
import { AIS_DEADLETTER_STREAM } from '../config/constants';
import type { ConfigService } from '../config/config.service';
import type { RedisService } from '../redis/redis.service';

/**
 * Component-style test for the retry/DLQ flow against an in-memory fake of the
 * Redis commands that FailureHandler uses.
 */
describe('DLQ flow: poison message exhausts retries and lands in deadletter', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('three failures on the same messageId → DLQ entry; counter cleared', async () => {
    const fake = makeFakeRedis();
    const handler = new FailureHandler(
      { client: fake.client } as unknown as RedisService,
      makeConfig(3, 100_000),
    );

    const stream = 'ais.events.v1';
    const group = 'storage-writer';
    const messageId = '1700000000000-0';
    const payload = { schemaVersion: 1, kind: 'position', mmsi: '241935000' };

    const r1 = await handler.onHandlerError({
      stream,
      group,
      messageId,
      payload,
      error: new Error('first'),
    });
    const r2 = await handler.onHandlerError({
      stream,
      group,
      messageId,
      payload,
      error: new Error('second'),
    });
    const r3 = await handler.onHandlerError({
      stream,
      group,
      messageId,
      payload,
      error: new Error('third'),
    });

    expect(r1).toEqual({ action: 'leave-unacked', attempts: 1 });
    expect(r2).toEqual({ action: 'leave-unacked', attempts: 2 });
    expect(r3.action).toBe('deadletter-and-ack');

    const dlq = fake.streams.get(AIS_DEADLETTER_STREAM) ?? [];
    expect(dlq).toHaveLength(1);
    const dlqPayload = JSON.parse(dlq[0]!.data);
    expect(dlqPayload).toMatchObject({
      originalMessageId: messageId,
      originalStream: stream,
      consumerGroup: group,
      attempts: 3,
      originalEvent: payload,
      error: { name: 'Error', message: 'third' },
    });
    expect(dlqPayload.firstFailedAt).toBeTruthy();
    expect(dlqPayload.lastFailedAt).toBeTruthy();

    expect(fake.hashes.has(`dlq:retry:${stream}:${group}:${messageId}`)).toBe(false);
  });

  it('a fresh messageId after replay starts with a fresh counter', async () => {
    const fake = makeFakeRedis();
    const handler = new FailureHandler(
      { client: fake.client } as unknown as RedisService,
      makeConfig(3, 100_000),
    );

    // Exhaust on the original id
    for (let i = 0; i < 3; i++) {
      await handler.onHandlerError({
        stream: 'ais.events.v1',
        group: 'storage-writer',
        messageId: 'orig-1',
        payload: { kind: 'position' },
        error: new Error('poison'),
      });
    }
    expect(fake.streams.get(AIS_DEADLETTER_STREAM)).toHaveLength(1);

    // Replay-published message arrives with a brand-new id; counter starts at 1.
    const replayResult = await handler.onHandlerError({
      stream: 'ais.events.v1',
      group: 'storage-writer',
      messageId: 'replay-1',
      payload: { kind: 'position' },
      error: new Error('still bad'),
    });
    expect(replayResult).toEqual({ action: 'leave-unacked', attempts: 1 });
  });
});

interface FakeStreamEntry {
  id: string;
  data: string;
}

function makeConfig(retryLimit: number, maxLen: number): ConfigService {
  return {
    get: jest.fn((k: string) => {
      if (k === 'STREAM_RETRY_LIMIT') return retryLimit;
      if (k === 'STREAM_MAXLEN') return maxLen;
      throw new Error(`unexpected key ${k}`);
    }),
  } as unknown as ConfigService;
}

function makeFakeRedis() {
  const hashes = new Map<string, Record<string, string>>();
  const streams = new Map<string, FakeStreamEntry[]>();
  let seq = 0;

  const ensureHash = (key: string) => {
    let h = hashes.get(key);
    if (!h) {
      h = {};
      hashes.set(key, h);
    }
    return h;
  };

  const client = {
    async hincrby(key: string, field: string, n: number): Promise<number> {
      const h = ensureHash(key);
      const next = (Number(h[field] ?? '0') || 0) + n;
      h[field] = String(next);
      return next;
    },
    async hsetnx(key: string, field: string, value: string): Promise<number> {
      const h = ensureHash(key);
      if (h[field] !== undefined) return 0;
      h[field] = value;
      return 1;
    },
    async hset(key: string, field: string, value: string): Promise<number> {
      ensureHash(key)[field] = value;
      return 1;
    },
    async hgetall(key: string): Promise<Record<string, string>> {
      return { ...(hashes.get(key) ?? {}) };
    },
    async expire(_key: string, _seconds: number): Promise<number> {
      return 1;
    },
    async del(key: string): Promise<number> {
      const had = hashes.delete(key);
      return had ? 1 : 0;
    },
    async xadd(stream: string, ..._args: unknown[]): Promise<string> {
      const args = _args as string[];
      const dataIdx = args.indexOf('data');
      const data = args[dataIdx + 1] ?? '';
      const id = `fake-${++seq}-0`;
      const list = streams.get(stream) ?? [];
      list.push({ id, data });
      streams.set(stream, list);
      return id;
    },
  };

  return { client, hashes, streams };
}
