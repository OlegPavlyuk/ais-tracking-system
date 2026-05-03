import { Counter, Gauge, Registry } from 'prom-client';
import { ConfigService } from '../shared/config/config.service';
import {
  AisProviderAdapter,
  ProviderNormalizer,
  ProviderPair,
  RawMessageHandler,
} from './provider';
import { ProviderRegistry } from './provider-registry';

class StubAdapter implements AisProviderAdapter {
  startCalls = 0;
  stopCalls = 0;
  private handlers: RawMessageHandler[] = [];
  reconnectCount = 0;
  lastMessageAt: string | null = null;
  startedAt: string | null = null;
  connected = false;

  constructor(readonly id: string) {}
  start() {
    this.startCalls += 1;
    this.startedAt = new Date().toISOString();
  }
  stop() {
    this.stopCalls += 1;
  }
  onMessage(h: RawMessageHandler) {
    this.handlers.push(h);
  }
  health() {
    return {
      providerId: this.id,
      connected: this.connected,
      lastMessageAt: this.lastMessageAt,
      reconnectCount: this.reconnectCount,
      startedAt: this.startedAt,
    };
  }
}

class StubNormalizer implements ProviderNormalizer {
  constructor(readonly provider: string) {}
  normalize() {
    return null;
  }
}

function makePair(id: string): ProviderPair {
  return { adapter: new StubAdapter(id), normalizer: new StubNormalizer(id) };
}

function baseEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://x:y@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function makeRegistry(
  candidates: ProviderPair[],
  envOverrides: Partial<NodeJS.ProcessEnv> = {},
): ProviderRegistry {
  const config = new ConfigService(baseEnv(envOverrides));
  const registers = [new Registry()];
  const counter = new Counter({ name: 'test_reconnects_total', help: 'h', labelNames: ['provider'], registers });
  const gauge1 = new Gauge({ name: 'test_connected', help: 'h', labelNames: ['provider'], registers });
  const gauge2 = new Gauge({ name: 'test_age_seconds', help: 'h', labelNames: ['provider'], registers });
  return new ProviderRegistry(config, candidates, gauge1, gauge2, counter);
}

describe('ProviderRegistry', () => {
  describe('static resolve', () => {
    it('resolves known providers preserving requested order', () => {
      const a = makePair('a');
      const b = makePair('b');
      const entries = ProviderRegistry.resolve([a, b], ['b', 'a']);
      expect(entries.map((e) => e.id)).toEqual(['b', 'a']);
    });

    it('throws on unknown provider', () => {
      expect(() => ProviderRegistry.resolve([makePair('aisstream')], ['unknown'])).toThrow(
        /Unknown AIS provider "unknown"/,
      );
    });

    it('throws when normalizer.provider does not match adapter.id', () => {
      const adapter = new StubAdapter('aisstream');
      const normalizer = new StubNormalizer('something-else');
      expect(() =>
        ProviderRegistry.resolve([{ adapter, normalizer }], ['aisstream']),
      ).toThrow(/Provider\/normalizer mismatch/);
    });

    it('deduplicates repeated entries in AIS_PROVIDERS', () => {
      const entries = ProviderRegistry.resolve(
        [makePair('aisstream')],
        ['aisstream', 'aisstream'],
      );
      expect(entries).toHaveLength(1);
    });

    it('returns no entries when requested list is empty', () => {
      expect(ProviderRegistry.resolve([makePair('aisstream')], [])).toEqual([]);
    });
  });

  describe('lifecycle (constructor + DI shape)', () => {
    afterEach(() => {
      // allow refreshMetrics interval timers to be cleared in onModuleDestroy
    });

    it('default AIS_PROVIDERS resolves to aisstream and starts the adapter on init', async () => {
      const pair = makePair('aisstream');
      const registry = makeRegistry([pair]);
      await registry.onModuleInit();
      expect((pair.adapter as StubAdapter).startCalls).toBe(1);
      expect(registry.providers().map((p) => p.id)).toEqual(['aisstream']);
      await registry.onModuleDestroy();
      expect((pair.adapter as StubAdapter).stopCalls).toBe(1);
    });

    it('throws at construction when AIS_PROVIDERS contains an unknown id', () => {
      expect(() => makeRegistry([makePair('aisstream')], { AIS_PROVIDERS: 'aisstream,unknown' })).toThrow(
        /Unknown AIS provider "unknown"/,
      );
    });

    it('snapshots delegate to adapter.health()', async () => {
      const pair = makePair('aisstream');
      const registry = makeRegistry([pair]);
      (pair.adapter as StubAdapter).connected = true;
      (pair.adapter as StubAdapter).lastMessageAt = '2026-05-03T12:00:00.000Z';
      const snaps = registry.snapshots();
      expect(snaps).toHaveLength(1);
      expect(snaps[0]).toMatchObject({
        providerId: 'aisstream',
        connected: true,
        lastMessageAt: '2026-05-03T12:00:00.000Z',
      });
      await registry.onModuleDestroy();
    });

    it('AIS_PROVIDERS=empty results in zero entries (no providers started)', async () => {
      const pair = makePair('aisstream');
      const registry = makeRegistry([pair], { AIS_PROVIDERS: '' });
      await registry.onModuleInit();
      expect((pair.adapter as StubAdapter).startCalls).toBe(0);
      expect(registry.providers()).toHaveLength(0);
      await registry.onModuleDestroy();
    });
  });
});
