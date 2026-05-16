import { Inject, Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { asc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../shared/db/db.service';
import { DB_QUERY_DURATION_SECONDS, DB_WRITES_TOTAL } from '../../shared/metrics/metric-names';
import { sanctionedEntities, vessels } from '../../storage/schema';
import { normalizeName, SanctionCandidate, SanctionMatch, SanctionsStatus } from './matcher';

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
    const rows = await this.dbs.db
      .select({
        id: vessels.id,
        mmsi: vessels.mmsi,
        imo: vessels.imo,
        name: vessels.name,
      })
      .from(vessels)
      .where(eq(vessels.mmsi, mmsi))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      mmsi: row.mmsi,
      imo: row.imo,
      name: row.name,
    };
  }

  async findVesselsNeedingEnrichment(
    limit: number,
    staleBefore: string,
  ): Promise<VesselFingerprint[]> {
    const rows = await this.timed('enrichment.findVesselsNeedingEnrichment', () =>
      this.dbs.db
        .select({
          id: vessels.id,
          mmsi: vessels.mmsi,
          imo: vessels.imo,
          name: vessels.name,
        })
        .from(vessels)
        .where(
          or(isNull(vessels.sanctionsCheckedAt), lt(vessels.sanctionsCheckedAt, new Date(staleBefore))),
        )
        .orderBy(sql`${vessels.sanctionsCheckedAt} NULLS FIRST`, asc(vessels.updatedAt))
        .limit(limit),
    );
    return rows.map((row) => ({
      id: row.id,
      mmsi: row.mmsi,
      imo: row.imo,
      name: row.name,
    }));
  }

  async findSanctionCandidatesByImo(imo: string): Promise<SanctionCandidate[]> {
    return this.timed('enrichment.findSanctionCandidatesByImo', () =>
      this.loadSanctionCandidates(eq(sanctionedEntities.imo, imo)),
    );
  }

  async findSanctionCandidatesByMmsi(mmsi: string): Promise<SanctionCandidate[]> {
    return this.timed('enrichment.findSanctionCandidatesByMmsi', () =>
      this.loadSanctionCandidates(eq(sanctionedEntities.mmsi, mmsi)),
    );
  }

  async findSanctionCandidatesByName(name: string | null): Promise<SanctionCandidate[]> {
    if (normalizeName(name).length === 0) return [];
    const candidateName = name ?? '';
    return this.timed('enrichment.findSanctionCandidatesByName', () =>
      this.loadSanctionCandidates(
        or(
          eq(sanctionedEntities.name, candidateName),
          sql`${sanctionedEntities.aliases} @> ARRAY[${candidateName}]::text[]`,
        ),
      ),
    );
  }

  private async loadSanctionCandidates(where: SQL | undefined): Promise<SanctionCandidate[]> {
    const rows = await this.dbs.db
      .select({
        id: sanctionedEntities.id,
        source: sanctionedEntities.source,
        sourceEntityId: sanctionedEntities.sourceEntityId,
        name: sanctionedEntities.name,
        imo: sanctionedEntities.imo,
        mmsi: sanctionedEntities.mmsi,
        aliases: sanctionedEntities.aliases,
        flag: sanctionedEntities.flag,
        listingDate: sanctionedEntities.listingDate,
        programs: sanctionedEntities.programs,
      })
      .from(sanctionedEntities)
      .where(where);
    return rows.map((r) => this.mapSanctionCandidate(r));
  }

  private mapSanctionCandidate(r: {
    id: string;
    source: string;
    sourceEntityId: string;
    name: string;
    imo: string | null;
    mmsi: string | null;
    aliases: string[];
    flag: string | null;
    listingDate: string | Date | null;
    programs: string[];
  }): SanctionCandidate {
    return {
      entityId: r.id,
      source: r.source,
      sourceEntityId: r.sourceEntityId,
      name: r.name,
      imo: r.imo,
      mmsi: r.mmsi,
      aliases: r.aliases,
      flag: r.flag,
      programs: r.programs,
      listingDate:
        r.listingDate === null || r.listingDate === undefined
          ? null
          : r.listingDate instanceof Date
            ? r.listingDate.toISOString().slice(0, 10)
            : String(r.listingDate),
    };
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
