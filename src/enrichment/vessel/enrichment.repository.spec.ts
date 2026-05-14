import { PgDialect } from 'drizzle-orm/pg-core';
import { DbService } from '../../shared/db/db.service';
import { stubCounter, stubHistogram } from '../../shared/testing/metrics-stubs';
import { EnrichmentRepository } from './enrichment.repository';
import { SanctionMatch } from './matcher';

const dialect = new PgDialect();

const captured = (): {
  exec: jest.Mock;
  lastQuery: () => { sql: string; params: unknown[] };
  setResult: (r: unknown) => void;
} => {
  let result: unknown = [];
  const exec = jest.fn((sqlObj: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const q = dialect.sqlToQuery(sqlObj);
    capturedCalls.push(q);
    return result;
  });
  const capturedCalls: { sql: string; params: unknown[] }[] = [];
  return {
    exec,
    lastQuery: () => capturedCalls[capturedCalls.length - 1]!,
    setResult: (r) => {
      result = r;
    },
  };
};

const fakeDbs = (exec: jest.Mock): DbService =>
  ({
    db: { execute: exec } as unknown as DbService['db'],
  }) as DbService;

describe('EnrichmentRepository.applyEnrichment', () => {
  const baseMatch: SanctionMatch = {
    entityId: 'e1',
    source: 'ofac',
    sourceEntityId: '15036',
    name: 'ARTAVIL',
    matchMethod: 'imo',
    aliases: [],
    flag: 'Iran',
    listingDate: '2020-01-15',
    programs: ['IRAN'],
  };

  it('emits a freshness-guarded UPDATE comparing sanctions_checked_at < checkedAt', async () => {
    const cap = captured();
    cap.setResult({ rowCount: 1 });
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());
    await repo.applyEnrichment({
      vesselId: 'v-1',
      status: 'sanctioned',
      matches: [baseMatch],
      checkedAt: '2026-05-02T00:00:00.000Z',
    });
    const q = cap.lastQuery();
    expect(q.sql).toMatch(/UPDATE\s+vessels/i);
    expect(q.sql).toMatch(/sanctions_checked_at IS NULL\s+OR\s+sanctions_checked_at <\s+\$/i);
    expect(q.params).toEqual(
      expect.arrayContaining([
        'sanctioned',
        '2026-05-02T00:00:00.000Z',
        JSON.stringify([baseMatch]),
        'v-1',
      ]),
    );
  });

  it('returns rowCount=1 (first check, sanctions_checked_at IS NULL succeeds)', async () => {
    const cap = captured();
    cap.setResult({ rowCount: 1 });
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());
    const updated = await repo.applyEnrichment({
      vesselId: 'v-1',
      status: 'clear',
      matches: [],
      checkedAt: '2026-05-02T00:00:00.000Z',
    });
    expect(updated).toBe(1);
  });

  it('returns rowCount=1 when newer checkedAt overwrites an older check', async () => {
    const cap = captured();
    cap.setResult({ rowCount: 1 });
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());
    const updated = await repo.applyEnrichment({
      vesselId: 'v-1',
      status: 'sanctioned',
      matches: [baseMatch],
      checkedAt: '2026-05-02T00:00:00.000Z',
    });
    expect(updated).toBe(1);
  });

  it('returns rowCount=0 when checkedAt is older or equal to the row (guard rejects)', async () => {
    const cap = captured();
    cap.setResult({ rowCount: 0 });
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());
    const updated = await repo.applyEnrichment({
      vesselId: 'v-1',
      status: 'sanctioned',
      matches: [baseMatch],
      checkedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(updated).toBe(0);
  });
});

describe('EnrichmentRepository sanctions candidate lookups', () => {
  it('loads IMO candidates with an indexed equality filter', async () => {
    const cap = captured();
    cap.setResult([
      {
        id: 'e1',
        source: 'ofac',
        sourceEntityId: '15036',
        name: 'ARTAVIL',
        imo: '9187629',
        mmsi: null,
        aliases: ['ABADAN'],
        flag: 'Iran',
        listingDate: null,
        programs: ['IRAN', 'NPWMD'],
      },
    ]);
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());

    const rows = await repo.findSanctionCandidatesByImo('9187629');

    const q = cap.lastQuery();
    expect(q.sql).toMatch(/FROM sanctioned_entities/i);
    expect(q.sql).toMatch(/WHERE imo = \$/i);
    expect(q.params).toContain('9187629');
    expect(cap.lastQuery().sql).toMatch(/programs/i);
    expect(rows[0]).toMatchObject({
      entityId: 'e1',
      source: 'ofac',
      sourceEntityId: '15036',
      programs: ['IRAN', 'NPWMD'],
    });
  });

  it('loads MMSI candidates with an indexed equality filter', async () => {
    const cap = captured();
    cap.setResult([]);
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());

    await repo.findSanctionCandidatesByMmsi('572469210');

    const q = cap.lastQuery();
    expect(q.sql).toMatch(/WHERE mmsi = \$/i);
    expect(q.params).toContain('572469210');
  });

  it('loads name fallback candidates by exact name or exact alias only', async () => {
    const cap = captured();
    cap.setResult([]);
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());

    await repo.findSanctionCandidatesByName('ARTAVIL');

    const q = cap.lastQuery();
    expect(q.sql).toMatch(/WHERE name = \$\d+ OR aliases @> ARRAY\[\$\d+\]::text\[\]/i);
    expect(q.params).toEqual(['ARTAVIL', 'ARTAVIL']);
  });

  it('does not query sanctions when name normalizes to empty', async () => {
    const cap = captured();
    const repo = new EnrichmentRepository(fakeDbs(cap.exec), stubHistogram(), stubCounter());

    const rows = await repo.findSanctionCandidatesByName('   ');

    expect(rows).toEqual([]);
    expect(cap.exec).not.toHaveBeenCalled();
  });
});
