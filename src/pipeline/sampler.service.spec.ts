import { SamplerService } from './sampler.service';
import { RedisService } from '../shared/redis/redis.service';
import { ConfigService } from '../shared/config/config.service';
import { PositionEvent, SCHEMA_VERSION } from '../contracts';

function makeFakeRedis() {
  const store = new Map<string, string>();
  const client = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
  };
  return { redis: { client } as unknown as RedisService, store };
}

const CONFIG_VALUES: Record<string, number> = {
  SAMPLER_MOVING_WINDOW_SECONDS: 10,
  SAMPLER_STATIONARY_WINDOW_SECONDS: 60,
  SAMPLER_STATIONARY_SOG_KN: 0.5,
  SAMPLER_STATE_TTL_SECONDS: 600,
};

function makeConfig(): ConfigService {
  return { get: (k: string) => CONFIG_VALUES[k] } as ConfigService;
}

function pos(overrides: Partial<PositionEvent> = {}): PositionEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'position',
    mmsi: '241935000',
    lat: 41.5,
    lon: 41.5,
    sog: 5,
    cog: 100,
    trueHeading: 100,
    navStatus: 0,
    rateOfTurn: 0,
    shipName: 'TEST',
    occurredAt: '2026-04-28T05:00:00.000Z',
    provider: 'aisstream',
    ingestedAt: '2026-04-28T05:00:00.000Z',
    ...overrides,
  };
}

describe('SamplerService', () => {
  it('emits on first sight of a vessel', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(await svc.shouldEmit(pos())).toBe(true);
  });

  it('drops moving vessel updates inside the 10s window', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:00.000Z', sog: 5 }))).toBe(true);
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:09.999Z', sog: 5 }))).toBe(false);
  });

  it('emits moving vessel update at exactly 10s', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:00.000Z', sog: 5 }))).toBe(true);
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:10.000Z', sog: 5 }))).toBe(true);
  });

  it('drops stationary vessel updates inside the 60s window', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:00.000Z', sog: 0.1 }))).toBe(true);
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:59.999Z', sog: 0.1 }))).toBe(false);
  });

  it('emits stationary vessel update at exactly 60s', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:00.000Z', sog: 0 }))).toBe(true);
    expect(await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:01:00.000Z', sog: 0 }))).toBe(true);
  });

  it('bypasses the window when navStatus changes', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(
      await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:00.000Z', sog: 0, navStatus: 0 })),
    ).toBe(true);
    expect(
      await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:01.000Z', sog: 0, navStatus: 5 })),
    ).toBe(true);
  });

  it('does not bypass when navStatus is unchanged but moves to null', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(
      await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:00.000Z', sog: 0, navStatus: 0 })),
    ).toBe(true);
    expect(
      await svc.shouldEmit(pos({ occurredAt: '2026-04-28T05:00:01.000Z', sog: 0, navStatus: null })),
    ).toBe(false);
  });

  it('treats corrupted Redis state as missing: emits and overwrites with fresh state', async () => {
    const { redis, store } = makeFakeRedis();
    store.set('sampler:241935000', '{not valid json');
    const svc = new SamplerService(redis, makeConfig());

    const event = pos({
      mmsi: '241935000',
      occurredAt: '2026-04-28T05:00:00.000Z',
      sog: 0,
      navStatus: 3,
    });
    expect(await svc.shouldEmit(event)).toBe(true);

    const written = store.get('sampler:241935000');
    expect(written).toBeDefined();
    expect(JSON.parse(written as string)).toEqual({
      lastEmittedAt: '2026-04-28T05:00:00.000Z',
      lastNavStatus: 3,
    });
  });

  it('isolates state per MMSI', async () => {
    const { redis } = makeFakeRedis();
    const svc = new SamplerService(redis, makeConfig());
    expect(await svc.shouldEmit(pos({ mmsi: '241935000' }))).toBe(true);
    expect(await svc.shouldEmit(pos({ mmsi: '213049000' }))).toBe(true);
  });
});
