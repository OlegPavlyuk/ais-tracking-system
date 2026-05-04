import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { KNOWN_STREAMS } from '../config/constants';
import { RedisService } from '../redis/redis.service';
import { AIS_STREAM_CONSUMER_LAG, AIS_STREAM_CONSUMER_PENDING } from './metric-names';

const REFRESH_MS = 5000;

/**
 * Periodically polls XINFO GROUPS for known streams and exposes per-group
 * lag/pending as gauges. Mirrors the calls used by /admin/streams so the
 * dashboard and admin endpoint stay consistent.
 */
@Injectable()
export class StreamLagService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamLagService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @InjectMetric(AIS_STREAM_CONSUMER_LAG) private readonly lag: Gauge<'stream' | 'group'>,
    @InjectMetric(AIS_STREAM_CONSUMER_PENDING) private readonly pending: Gauge<'stream' | 'group'>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick().catch(() => undefined), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      for (const stream of KNOWN_STREAMS) {
        await this.refreshStream(stream);
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async refreshStream(stream: string): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.redis.client.xinfo('GROUPS', stream);
    } catch (err) {
      const msg = (err as Error).message;
      if (/no such key/i.test(msg)) return;
      this.logger.warn(`xinfo groups ${stream} failed: ${msg}`);
      return;
    }
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      if (!Array.isArray(entry)) continue;
      const map = pairsToMap(entry as unknown[]);
      const group = String(map.name ?? '');
      if (!group) continue;
      const lag = numberOrNull(map.lag);
      const pending = numberOrNull(map.pending) ?? 0;
      if (lag !== null) this.lag.set({ stream, group }, lag);
      this.pending.set({ stream, group }, pending);
    }
  }
}

function pairsToMap(arr: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const key = arr[i];
    if (typeof key === 'string') out[key] = arr[i + 1];
  }
  return out;
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') return Number(v);
  return null;
}
