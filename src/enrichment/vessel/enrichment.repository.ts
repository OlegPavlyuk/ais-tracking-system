import { Inject, Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { sql } from 'drizzle-orm';
import { DbService } from '../../shared/db/db.service';
import { DB_QUERY_DURATION_SECONDS, DB_WRITES_TOTAL } from '../../shared/metrics/metric-names';
import { SanctionCandidate, SanctionMatch, SanctionsStatus } from './matcher';

export interface VesselFingerprint {
  id: string;
  mmsi: string;
  imo: string | null;
  name: string | null;
}

export interface ApplyEnrichmentInput {
  vesselId: string;
  status: SanctionsStatus;
  matches: SanctionMatch[];
  /** Timestamp the worker performed the check at; doubles as the freshness guard upper bound. */
  checkedAt: string;
}

@Injectable()
export class EnrichmentRepository {
  constructor(
    @Inject(DbService) private readonly dbs: DbService,
    @InjectMetric(DB_QUERY_DURATION_SECONDS)
    private readonly queryDuration: Histogram<'query'>,
    @InjectMetric(DB_WRITES_TOTAL)
    private readonly writes: Counter<'table'>,
  ) {}

  private async timed<T>(query: string, fn: () => Promise<T>): Promise<T> {
    const end = this.queryDuration.startTimer({ query });
    try {
      return await fn();
    } finally {
      end();
    }
  }

  async findVesselFingerprintByMmsi(mmsi: string): Promise<VesselFingerprint | null> {
    const rows = await this.dbs.db.execute(sql`
      SELECT id, mmsi, imo, name
      FROM vessels
      WHERE mmsi = ${mmsi}
      LIMIT 1
    `);
    const row = (rows as unknown as Array<Record<string, unknown>>)[0];
    if (!row) return null;
    return {
      id: row.id as string,
      mmsi: row.mmsi as string,
      imo: (row.imo as string | null) ?? null,
      name: (row.name as string | null) ?? null,
    };
  }

  async loadAllSanctionCandidates(): Promise<SanctionCandidate[]> {
    return this.timed('enrichment.loadSanctionCandidates', () => this.loadAllSanctionCandidatesInner());
  }

  private async loadAllSanctionCandidatesInner(): Promise<SanctionCandidate[]> {
    const rows = await this.dbs.db.execute(sql`
      SELECT
        id,
        source,
        source_entity_id AS "sourceEntityId",
        name,
        imo,
        mmsi,
        aliases,
        flag,
        listing_date AS "listingDate",
        programs
      FROM sanctioned_entities
    `);
    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      entityId: r.id as string,
      source: r.source as string,
      sourceEntityId: r.sourceEntityId as string,
      name: r.name as string,
      imo: (r.imo as string | null) ?? null,
      mmsi: (r.mmsi as string | null) ?? null,
      aliases: (r.aliases as string[] | null) ?? [],
      flag: (r.flag as string | null) ?? null,
      programs: (r.programs as string[] | null) ?? [],
      listingDate:
        r.listingDate === null || r.listingDate === undefined
          ? null
          : r.listingDate instanceof Date
            ? (r.listingDate.toISOString().slice(0, 10))
            : String(r.listingDate),
    }));
  }

  /**
   * Freshness-guarded write: only applies when the row hasn't been checked by a newer job.
   */
  async applyEnrichment(input: ApplyEnrichmentInput): Promise<number> {
    const updated = await this.timed('enrichment.applyEnrichment', async () => {
      const result = await this.dbs.db.execute(sql`
        UPDATE vessels
          SET sanctions_status = ${input.status},
              sanctions_checked_at = ${input.checkedAt},
              sanctions_matches = ${JSON.stringify(input.matches)}::jsonb,
              updated_at = NOW()
        WHERE id = ${input.vesselId}
          AND (
            sanctions_checked_at IS NULL
            OR sanctions_checked_at < ${input.checkedAt}
          )
      `);
      const r = result as unknown as { rowCount?: number; count?: number; length?: number };
      return r.rowCount ?? r.count ?? r.length ?? 0;
    });
    if (updated > 0) this.writes.inc({ table: 'vessels' });
    return updated;
  }
}
