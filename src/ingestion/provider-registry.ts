import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { ConfigService } from '../shared/config/config.service';
import {
  ProviderHealth,
  ProviderHealthSource,
} from '../shared/health/provider-health';
import {
  AIS_PROVIDER_CONNECTED,
  AIS_PROVIDER_LAST_MESSAGE_AGE_SECONDS,
  AIS_PROVIDER_RECONNECTS_TOTAL,
} from '../shared/metrics/provider-metrics';
import { AisProviderAdapter, ProviderNormalizer, ProviderPair } from './provider';

/** DI token for the list of candidate (adapter, normalizer) pairs the registry resolves over. */
export const PROVIDER_PAIRS = Symbol('PROVIDER_PAIRS');

const METRIC_REFRESH_MS = 5_000;

interface RegistryEntry {
  id: string;
  adapter: AisProviderAdapter;
  normalizer: ProviderNormalizer;
}

/**
 * Resolves AIS_PROVIDERS env into a fixed set of (adapter, normalizer) pairs.
 * Owns adapter lifecycle and the provider-health metric refresh loop.
 */
@Injectable()
export class ProviderRegistry
  implements OnModuleInit, OnModuleDestroy, ProviderHealthSource
{
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly entries: RegistryEntry[];
  private metricTimer: ReturnType<typeof setInterval> | null = null;
  private readonly reconnectBaseline = new Map<string, number>();

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(PROVIDER_PAIRS) candidates: ProviderPair[],
    @InjectMetric(AIS_PROVIDER_CONNECTED)
    private readonly connectedGauge: Gauge<'provider'>,
    @InjectMetric(AIS_PROVIDER_LAST_MESSAGE_AGE_SECONDS)
    private readonly lastMessageAgeGauge: Gauge<'provider'>,
    @InjectMetric(AIS_PROVIDER_RECONNECTS_TOTAL)
    private readonly reconnectsCounter: Counter<'provider'>,
  ) {
    this.entries = ProviderRegistry.resolve(candidates, config.get('AIS_PROVIDERS'));
  }

  static resolve(candidates: ProviderPair[], requested: readonly string[]): RegistryEntry[] {
    const byId = new Map<string, ProviderPair>();
    for (const pair of candidates) {
      byId.set(pair.adapter.id, pair);
    }
    const seen = new Set<string>();
    const entries: RegistryEntry[] = [];
    for (const id of requested) {
      if (seen.has(id)) continue;
      seen.add(id);
      const pair = byId.get(id);
      if (!pair) {
        const known = [...byId.keys()].join(', ') || '(none)';
        throw new Error(
          `Unknown AIS provider "${id}" in AIS_PROVIDERS. Known providers: ${known}`,
        );
      }
      if (pair.normalizer.provider !== id) {
        throw new Error(
          `Provider/normalizer mismatch for "${id}": normalizer.provider="${pair.normalizer.provider}"`,
        );
      }
      entries.push({ id, adapter: pair.adapter, normalizer: pair.normalizer });
    }
    return entries;
  }

  providers(): ReadonlyArray<RegistryEntry> {
    return this.entries;
  }

  snapshots(): ProviderHealth[] {
    return this.entries.map((e) => e.adapter.health());
  }

  async onModuleInit(): Promise<void> {
    if (this.entries.length === 0) {
      this.logger.warn('AIS_PROVIDERS is empty — no providers will start');
      return;
    }
    for (const entry of this.entries) {
      this.reconnectBaseline.set(entry.id, entry.adapter.health().reconnectCount);
      await entry.adapter.start();
      this.logger.log(`provider "${entry.id}" started`);
    }
    this.refreshMetrics();
    this.metricTimer = setInterval(() => this.refreshMetrics(), METRIC_REFRESH_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.metricTimer) {
      clearInterval(this.metricTimer);
      this.metricTimer = null;
    }
    for (const entry of this.entries) {
      try {
        await entry.adapter.stop();
      } catch (err) {
        this.logger.warn(
          `provider "${entry.id}" stop failed: ${(err as Error).message}`,
        );
      }
    }
  }

  private refreshMetrics(): void {
    const now = Date.now();
    for (const entry of this.entries) {
      const h = entry.adapter.health();
      this.connectedGauge.set({ provider: entry.id }, h.connected ? 1 : 0);
      const ageSec =
        h.lastMessageAt !== null
          ? Math.max(0, (now - new Date(h.lastMessageAt).getTime()) / 1000)
          : -1;
      this.lastMessageAgeGauge.set({ provider: entry.id }, ageSec);
      const baseline = this.reconnectBaseline.get(entry.id) ?? 0;
      const delta = h.reconnectCount - baseline;
      if (delta > 0) {
        this.reconnectsCounter.inc({ provider: entry.id }, delta);
        this.reconnectBaseline.set(entry.id, h.reconnectCount);
      }
    }
  }
}
