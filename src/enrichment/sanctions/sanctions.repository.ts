import { Inject, Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DbService } from '../../shared/db/db.service';
import { DB_WRITES_TOTAL } from '../../shared/metrics/metric-names';
import { sanctionsImportRuns } from '../../storage/schema';
import { VesselEntity } from './sanctions-source.adapter';

const SANCTIONS_IMPORT_ADVISORY_LOCK_NAMESPACE = 1_934_910_515;

export interface SanctionsImportRunRow {
  id: number;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  recordsImported: number;
  errors: unknown[];
}

export type AdvisoryLockResult<T> =
  | { acquired: false; result?: never }
  | { acquired: true; result: T };

@Injectable()
export class SanctionsRepository {
  constructor(
    @Inject(DbService) private readonly dbs: DbService,
    @InjectMetric(DB_WRITES_TOTAL)
    private readonly writes: Counter<'table'>,
  ) {}

  async startRun(source: string): Promise<number> {
    const rows = await this.dbs.db
      .insert(sanctionsImportRuns)
      .values({ source, status: 'running' })
      .returning({ id: sanctionsImportRuns.id });
    const row = rows[0];
    if (!row) throw new Error('failed to insert sanctions_import_runs row');
    return Number(row.id);
  }

  async withSourceImportLock<T>(
    source: string,
    callback: () => Promise<T>,
  ): Promise<AdvisoryLockResult<T>> {
    return this.dbs.withReservedConnection(async (connection) => {
      const lockRows = await connection`
        SELECT pg_try_advisory_lock(
          ${SANCTIONS_IMPORT_ADVISORY_LOCK_NAMESPACE},
          hashtext(${source})
        ) AS acquired
      `;
      const acquired = Boolean((lockRows as unknown as Array<{ acquired: boolean }>)[0]?.acquired);
      if (!acquired) return { acquired: false };
      try {
        return { acquired: true, result: await callback() };
      } finally {
        await connection`
          SELECT pg_advisory_unlock(
            ${SANCTIONS_IMPORT_ADVISORY_LOCK_NAMESPACE},
            hashtext(${source})
          )
        `;
      }
    });
  }

  async finishRun(
    runId: number,
    status: 'completed' | 'failed',
    recordsImported: number,
    errors: unknown[],
  ): Promise<void> {
    await this.dbs.db
      .update(sanctionsImportRuns)
      .set({
        finishedAt: sql`NOW()`,
        status,
        recordsImported,
        errors,
      })
      .where(eq(sanctionsImportRuns.id, runId));
  }

  async upsertEntities(source: string, batch: VesselEntity[]): Promise<void> {
    if (batch.length === 0) return;
    await this.dbs.db.transaction(async (tx) => {
      for (const e of batch) {
        await tx.execute(sql`
          INSERT INTO sanctioned_entities (
            source, source_entity_id, name, imo, mmsi, aliases, flag, listing_date, programs, raw_payload, updated_at
          ) VALUES (
            ${source},
            ${e.sourceEntityId},
            ${e.name},
            ${e.imo},
            ${e.mmsi},
            ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(e.aliases)}::jsonb)),
            ${e.flag},
            ${e.listingDate},
            ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(e.programs)}::jsonb)),
            ${JSON.stringify(e.rawPayload)}::jsonb,
            NOW()
          )
          ON CONFLICT (source, source_entity_id) DO UPDATE
            SET name = EXCLUDED.name,
                imo = EXCLUDED.imo,
                mmsi = EXCLUDED.mmsi,
                aliases = EXCLUDED.aliases,
                flag = EXCLUDED.flag,
                listing_date = EXCLUDED.listing_date,
                programs = EXCLUDED.programs,
                raw_payload = EXCLUDED.raw_payload,
                updated_at = NOW()
        `);
      }
    });
    this.writes.inc({ table: 'sanctioned_entities' }, batch.length);
  }

  async findRecentRuns(limit: number): Promise<SanctionsImportRunRow[]> {
    const rows = await this.dbs.db
      .select()
      .from(sanctionsImportRuns)
      .orderBy(desc(sanctionsImportRuns.startedAt))
      .limit(limit);
    return rows.map((row) => this.mapImportRun(row));
  }

  async findLastRunBySource(source: string): Promise<SanctionsImportRunRow | null> {
    const rows = await this.dbs.db
      .select()
      .from(sanctionsImportRuns)
      .where(eq(sanctionsImportRuns.source, source))
      .orderBy(desc(sanctionsImportRuns.startedAt))
      .limit(1);
    const row = rows[0];
    return row ? this.mapImportRun(row) : null;
  }

  async hasSuccessfulRunBySource(source: string): Promise<boolean> {
    const rows = await this.dbs.db
      .select({ id: sanctionsImportRuns.id })
      .from(sanctionsImportRuns)
      .where(
        and(eq(sanctionsImportRuns.source, source), eq(sanctionsImportRuns.status, 'completed')),
      )
      .limit(1);
    return rows.length > 0;
  }

  private mapImportRun(row: typeof sanctionsImportRuns.$inferSelect): SanctionsImportRunRow {
    const toIso = (v: Date | string): string =>
      v instanceof Date ? v.toISOString() : new Date(v).toISOString();
    return {
      id: Number(row.id),
      source: row.source,
      startedAt: toIso(row.startedAt),
      finishedAt: row.finishedAt === null ? null : toIso(row.finishedAt),
      status: row.status,
      recordsImported: Number(row.recordsImported),
      errors: (row.errors as unknown[]) ?? [],
    };
  }
}
