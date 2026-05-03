import { ModuleRef } from '@nestjs/core';
import { HealthService } from './health.service';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '../config/config.service';
import {
  PROVIDER_HEALTH_SOURCE,
  ProviderHealth,
  ProviderHealthSource,
} from './provider-health';

const fakeDb = (ok: boolean): DbService => ({ ping: jest.fn().mockResolvedValue(ok) }) as unknown as DbService;
const fakeRedis = (ok: boolean): RedisService =>
  ({ ping: jest.fn().mockResolvedValue(ok) }) as unknown as RedisService;

function makeConfig(thresholdSeconds = 60): ConfigService {
  return new ConfigService({
    DATABASE_URL: 'postgres://x:y@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    PROVIDER_FEED_DEGRADED_SECONDS: String(thresholdSeconds),
  } as NodeJS.ProcessEnv);
}

function makeModuleRef(source: ProviderHealthSource | null): ModuleRef {
  return {
    get: jest.fn((token: unknown) => {
      if (token === PROVIDER_HEALTH_SOURCE && source) return source;
      throw new Error('not found');
    }),
  } as unknown as ModuleRef;
}

function snapshot(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return {
    providerId: 'aisstream',
    connected: true,
    lastMessageAt: new Date().toISOString(),
    reconnectCount: 0,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('HealthService', () => {
  it('liveness is unconditional', () => {
    const svc = new HealthService(fakeDb(false), fakeRedis(false), makeConfig(), makeModuleRef(null));
    expect(svc.liveness()).toEqual({ alive: true });
  });

  it('readiness is true only when both DB and Redis are reachable', async () => {
    const svc = new HealthService(fakeDb(true), fakeRedis(true), makeConfig(), makeModuleRef(null));
    svc.onModuleInit();
    const r = await svc.readiness();
    expect(r.ready).toBe(true);
    expect(r.checks).toEqual({ db: true, redis: true });
    expect(r.feedDegraded).toBe(false);
    expect(r.providers).toBeUndefined();
  });

  it('readiness is false if DB is down', async () => {
    const svc = new HealthService(fakeDb(false), fakeRedis(true), makeConfig(), makeModuleRef(null));
    svc.onModuleInit();
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.checks.db).toBe(false);
  });

  it('readiness is false if Redis is down', async () => {
    const svc = new HealthService(fakeDb(true), fakeRedis(false), makeConfig(), makeModuleRef(null));
    svc.onModuleInit();
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.checks.redis).toBe(false);
  });

  describe('feedDegraded derivation', () => {
    const svc = new HealthService(fakeDb(true), fakeRedis(true), makeConfig(60), makeModuleRef(null));
    const now = new Date('2026-05-03T12:00:00.000Z');

    it('false when no providers registered', () => {
      expect(svc.deriveFeedDegraded([], now)).toBe(false);
    });

    it('false when provider has fresh lastMessageAt', () => {
      const fresh = new Date(now.getTime() - 10_000).toISOString();
      expect(svc.deriveFeedDegraded([snapshot({ lastMessageAt: fresh })], now)).toBe(false);
    });

    it('true when provider lastMessageAt is older than threshold', () => {
      const stale = new Date(now.getTime() - 90_000).toISOString();
      expect(svc.deriveFeedDegraded([snapshot({ lastMessageAt: stale })], now)).toBe(true);
    });

    it('falls back to startedAt when no message yet received but adapter started', () => {
      const startedRecently = new Date(now.getTime() - 30_000).toISOString();
      const startedAgesAgo = new Date(now.getTime() - 120_000).toISOString();
      expect(
        svc.deriveFeedDegraded(
          [snapshot({ lastMessageAt: null, startedAt: startedRecently })],
          now,
        ),
      ).toBe(false);
      expect(
        svc.deriveFeedDegraded(
          [snapshot({ lastMessageAt: null, startedAt: startedAgesAgo })],
          now,
        ),
      ).toBe(true);
    });

    it('not degraded when adapter never started (e.g. missing API key)', () => {
      expect(
        svc.deriveFeedDegraded(
          [snapshot({ lastMessageAt: null, startedAt: null })],
          now,
        ),
      ).toBe(false);
    });

    it('any single degraded provider flips the rollup', () => {
      const fresh = snapshot({ lastMessageAt: new Date(now.getTime() - 1_000).toISOString() });
      const stale = snapshot({
        providerId: 'other',
        lastMessageAt: new Date(now.getTime() - 600_000).toISOString(),
      });
      expect(svc.deriveFeedDegraded([fresh, stale], now)).toBe(true);
    });
  });

  it('reads provider snapshots through the bound source after init', async () => {
    const stale = new Date(Date.now() - 180_000).toISOString();
    const source: ProviderHealthSource = {
      snapshots: () => [snapshot({ lastMessageAt: stale })],
    };
    const svc = new HealthService(fakeDb(true), fakeRedis(true), makeConfig(60), makeModuleRef(source));
    svc.onModuleInit();
    const r = await svc.readiness();
    expect(r.feedDegraded).toBe(true);
    expect(r.providers).toHaveLength(1);
    expect(r.ready).toBe(true); // stays 200 even when degraded
  });
});
