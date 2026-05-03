import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '../config/config.service';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import {
  PROVIDER_HEALTH_SOURCE,
  ProviderHealth,
  ProviderHealthSource,
} from './provider-health';

export interface ReadinessReport {
  ready: boolean;
  checks: {
    db: boolean;
    redis: boolean;
  };
  feedDegraded: boolean;
  providers?: ProviderHealth[];
}

@Injectable()
export class HealthService implements OnModuleInit {
  private providerHealth: ProviderHealthSource | null = null;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.providerHealth = this.moduleRef.get<ProviderHealthSource>(PROVIDER_HEALTH_SOURCE, {
        strict: false,
      });
    } catch {
      // Provider source not bound (e.g. api-only role without ingestion). feedDegraded stays false.
      this.providerHealth = null;
    }
  }

  liveness(): { alive: true } {
    return { alive: true };
  }

  async readiness(): Promise<ReadinessReport> {
    const [db, redis] = await Promise.all([this.db.ping(), this.redis.ping()]);
    const snapshots = this.providerHealth?.snapshots() ?? [];
    const feedDegraded = this.deriveFeedDegraded(snapshots, new Date());
    const report: ReadinessReport = {
      ready: db && redis,
      checks: { db, redis },
      feedDegraded,
    };
    if (snapshots.length > 0) report.providers = snapshots;
    return report;
  }

  /** Visible for tests. */
  deriveFeedDegraded(snapshots: ProviderHealth[], now: Date): boolean {
    if (snapshots.length === 0) return false;
    const thresholdMs = this.config.get('PROVIDER_FEED_DEGRADED_SECONDS') * 1000;
    return snapshots.some((s) => {
      const reference = s.lastMessageAt ?? s.startedAt;
      if (!reference) return false; // adapter never started (e.g. missing API key) — not degraded
      return now.getTime() - new Date(reference).getTime() > thresholdMs;
    });
  }
}
