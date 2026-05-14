import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DbService } from '../shared/db/db.service';
import { ConfigService } from '../shared/config/config.service';
import {
  HISTORY_PARTITION_MAINTENANCE_ON_STARTUP,
  HISTORY_PARTITION_MAINTENANCE_UTC_HOUR,
  HISTORY_PARTITION_MAINTENANCE_UTC_MINUTE,
  HISTORY_PARTITION_LOCK_ID,
  HISTORY_RETENTION_SAFETY_DAYS,
  historyPartitionWindow,
  nextDailyMaintenanceDelayMs,
  planHistoryPartitionMaintenance,
} from './history-partitions';

interface QueryExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface HistoryPartitionMaintenanceResult {
  acquired: boolean;
  created: number;
  dropped: number;
  retainedFrom: string;
  precreatedThrough: string;
}

@Injectable()
export class HistoryPartitionMaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HistoryPartitionMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (
      HISTORY_PARTITION_MAINTENANCE_ON_STARTUP &&
      this.config.get('HISTORY_PARTITION_MAINTENANCE_ENABLED')
    ) {
      await this.maintain().catch((err) => {
        this.logger.error(
          `history partition startup maintenance failed: ${(err as Error).message}`,
        );
      });
    }
    if (this.config.get('HISTORY_PARTITION_MAINTENANCE_ENABLED')) {
      this.scheduleNext();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async maintain(now = new Date()): Promise<HistoryPartitionMaintenanceResult> {
    const policy = {
      retentionDays: this.config.get('HISTORY_RETENTION_DAYS'),
      safetyDays: HISTORY_RETENTION_SAFETY_DAYS,
      precreateDays: this.config.get('HISTORY_PRECREATE_DAYS'),
    };
    const window = historyPartitionWindow(now, policy);

    return this.dbs.db.transaction(async (tx) => {
      const lockRows = await tx.execute(sql`
        SELECT pg_try_advisory_xact_lock(${HISTORY_PARTITION_LOCK_ID}) AS acquired
      `);
      const acquired = Boolean((lockRows as unknown as Array<{ acquired: boolean }>)[0]?.acquired);
      if (!acquired) {
        this.logger.warn('history partition maintenance skipped because advisory lock is held');
        return {
          acquired: false,
          created: 0,
          dropped: 0,
          retainedFrom: window.cutoffDay.toISOString(),
          precreatedThrough: window.lastFutureDay.toISOString(),
        };
      }

      const existing = await this.listExistingPartitionNames(tx);
      const plan = planHistoryPartitionMaintenance(existing, now, policy);
      for (const partition of plan.create) {
        await tx.execute(sql.raw(partition.sql));
      }
      for (const partition of plan.drop) {
        await tx.execute(sql.raw(partition.sql));
      }

      const result = {
        acquired: true,
        created: plan.create.length,
        dropped: plan.drop.length,
        retainedFrom: plan.cutoffDay.toISOString(),
        precreatedThrough: plan.lastFutureDay.toISOString(),
      };
      this.logger.log(
        `history partition maintenance complete created=${result.created} dropped=${result.dropped} retainedFrom=${result.retainedFrom} precreatedThrough=${result.precreatedThrough}`,
      );
      return result;
    });
  }

  private async listExistingPartitionNames(tx: QueryExecutor): Promise<string[]> {
    const rows = await tx.execute(sql`
      SELECT child.relname AS name
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child ON pg_inherits.inhrelid = child.oid
      JOIN pg_namespace ns ON child.relnamespace = ns.oid
      WHERE parent.relname = 'vessel_positions_history'
        AND ns.nspname = 'public'
    `);
    return (rows as Array<{ name: string }>).map((row) => row.name);
  }

  private scheduleNext(): void {
    const delay = nextDailyMaintenanceDelayMs(
      new Date(),
      HISTORY_PARTITION_MAINTENANCE_UTC_HOUR,
      HISTORY_PARTITION_MAINTENANCE_UTC_MINUTE,
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.maintain()
        .catch((err) => {
          this.logger.error(
            `scheduled history partition maintenance failed: ${(err as Error).message}`,
          );
        })
        .finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref?.();
  }
}
