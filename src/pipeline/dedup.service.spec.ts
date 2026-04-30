import { DedupService } from './dedup.service';
import { RedisService } from '../shared/redis/redis.service';
import { ConfigService } from '../shared/config/config.service';

function makeFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  let now = 0;
  const advance = (ms: number) => {
    now += ms;
  };
  const client = {
    async set(key: string, value: string, _ex: 'EX', ttlSeconds: number, _nx: 'NX') {
      const existing = store.get(key);
      if (existing && existing.expiresAt > now) return null;
      store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
      return 'OK';
    },
  };
  return { redis: { client } as unknown as RedisService, advance };
}

function makeConfig(ttl = 600): ConfigService {
  return { get: (k: string) => (k === 'DEDUP_TTL_SECONDS' ? ttl : undefined) } as ConfigService;
}

describe('DedupService', () => {
  it('accepts the first sight of (mmsi, occurredAt)', async () => {
    const { redis } = makeFakeRedis();
    const svc = new DedupService(redis, makeConfig());
    expect(await svc.shouldAccept('241935000', '2026-04-28T04:52:17.518Z')).toBe(true);
  });

  it('rejects an immediate duplicate of (mmsi, occurredAt)', async () => {
    const { redis } = makeFakeRedis();
    const svc = new DedupService(redis, makeConfig());
    const t = '2026-04-28T04:52:17.518Z';
    expect(await svc.shouldAccept('241935000', t)).toBe(true);
    expect(await svc.shouldAccept('241935000', t)).toBe(false);
  });

  it('does not collide across different MMSIs at the same occurredAt', async () => {
    const { redis } = makeFakeRedis();
    const svc = new DedupService(redis, makeConfig());
    const t = '2026-04-28T04:52:17.518Z';
    expect(await svc.shouldAccept('241935000', t)).toBe(true);
    expect(await svc.shouldAccept('213049000', t)).toBe(true);
  });

  it('does not collide across different occurredAt for the same MMSI', async () => {
    const { redis } = makeFakeRedis();
    const svc = new DedupService(redis, makeConfig());
    expect(await svc.shouldAccept('241935000', '2026-04-28T04:52:17.518Z')).toBe(true);
    expect(await svc.shouldAccept('241935000', '2026-04-28T04:52:18.000Z')).toBe(true);
  });

  it('accepts the same (mmsi, occurredAt) again after the TTL window expires', async () => {
    const { redis, advance } = makeFakeRedis();
    const svc = new DedupService(redis, makeConfig(600));
    const t = '2026-04-28T04:52:17.518Z';
    expect(await svc.shouldAccept('241935000', t)).toBe(true);
    expect(await svc.shouldAccept('241935000', t)).toBe(false);
    advance(600 * 1000 + 1);
    expect(await svc.shouldAccept('241935000', t)).toBe(true);
  });
});
