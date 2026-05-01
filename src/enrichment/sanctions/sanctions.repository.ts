import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../../shared/db/db.service';
import { VesselEntity } from './sanctions-source.adapter';

export interface SanctionsImportRunRow {
  id: number;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  recordsImported: number;
  errors: unknown[];
}

@Injectable()
export class SanctionsRepository {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  async startRun(source: string): Promise<number> {
    const rows = await this.dbs.db.execute(sql`
      INSERT INTO sanctions_import_runs (source, status)
      VALUES (${source}, 'running')
      RETURNING id
    `);
    const row = (rows as unknown as Array<{ id: number | string }>)[0];
    if (!row) throw new Error('failed to insert sanctions_import_runs row');
    return Number(row.id);
  }

  async finishRun(
    runId: number,
    status: 'completed' | 'failed',
    recordsImported: number,
    errors: unknown[],
  ): Promise<void> {
    await this.dbs.db.execute(sql`
      UPDATE sanctions_import_runs
        SET finished_at = NOW(),
            status = ${status},
            records_imported = ${recordsImported},
            errors = ${JSON.stringify(errors)}::jsonb
      WHERE id = ${runId}
    `);
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
  }

  async findLastRunBySource(source: string): Promise<SanctionsImportRunRow | null> {
    const rows = await this.dbs.db.execute(sql`
      SELECT
        id,
        source,
        started_at      AS "startedAt",
        finished_at     AS "finishedAt",
        status,
        records_imported AS "recordsImported",
        errors
      FROM sanctions_import_runs
      WHERE source = ${source}
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = (rows as unknown as Array<Record<string, unknown>>)[0];
    if (!row) return null;
    const toIso = (v: unknown): string =>
      v instanceof Date ? v.toISOString() : new Date(v as string).toISOString();
    return {
      id: Number(row.id),
      source: row.source as string,
      startedAt: toIso(row.startedAt),
      finishedAt: row.finishedAt === null ? null : toIso(row.finishedAt),
      status: row.status as string,
      recordsImported: Number(row.recordsImported),
      errors: (row.errors as unknown[]) ?? [],
    };
  }
}
