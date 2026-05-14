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

const fakeDbs = (exec: jest.Mock, select?: jest.Mock): DbService =>
  ({
    db: { execute: exec, ...(select ? { select } : {}) } as unknown as DbService['db'],
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
  it('loads vessel fingerprints through a targeted Drizzle path', async () => {
    const chain = makeSelectChain([
      {
        id: 'v-1',
        mmsi: '572469210',
        imo: '9187629',
        name: 'ARTAVIL',
      },
    ]);
    const select = jest.fn(() => chain);
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    await expect(repo.findVesselFingerprintByMmsi('572469210')).resolves.toEqual({
      id: 'v-1',
      mmsi: '572469210',
      imo: '9187629',
      name: 'ARTAVIL',
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('returns null when no vessel fingerprint exists', async () => {
    const chain = makeSelectChain([]);
    const select = jest.fn(() => chain);
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    await expect(repo.findVesselFingerprintByMmsi('572469210')).resolves.toBeNull();

    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('loads IMO candidates through a targeted Drizzle path', async () => {
    const chain = makeSelectChain([
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
    const select = jest.fn(() => chain);
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    const rows = await repo.findSanctionCandidatesByImo('9187629');

    expect(select).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({
      entityId: 'e1',
      source: 'ofac',
      sourceEntityId: '15036',
      programs: ['IRAN', 'NPWMD'],
    });
  });

  it('maps date objects in candidate rows to ISO dates', async () => {
    const chain = makeSelectChain([
      {
        id: 'e1',
        source: 'ofac',
        sourceEntityId: '15036',
        name: 'ARTAVIL',
        imo: '9187629',
        mmsi: null,
        aliases: ['ABADAN'],
        flag: 'Iran',
        listingDate: new Date('2020-01-15T00:00:00.000Z'),
        programs: ['IRAN', 'NPWMD'],
      },
    ]);
    const select = jest.fn(() => chain);
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    const rows = await repo.findSanctionCandidatesByImo('9187629');

    expect(rows[0]?.listingDate).toBe('2020-01-15');
  });

  it('loads MMSI candidates through a targeted Drizzle path', async () => {
    const chain = makeSelectChain([]);
    const select = jest.fn(() => chain);
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    await repo.findSanctionCandidatesByMmsi('572469210');

    expect(select).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it('loads name fallback candidates through a targeted Drizzle path', async () => {
    const chain = makeSelectChain([]);
    const select = jest.fn(() => chain);
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    await repo.findSanctionCandidatesByName('ARTAVIL');

    expect(select).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when name fallback has no DB rows', async () => {
    const chain = makeSelectChain([]);
    const select = jest.fn(() => chain);
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    await expect(repo.findSanctionCandidatesByName('ARTAVIL')).resolves.toEqual([]);

    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it('does not query sanctions when name normalizes to empty', async () => {
    const select = jest.fn();
    const repo = new EnrichmentRepository(
      fakeDbs(jest.fn(), select),
      stubHistogram(),
      stubCounter(),
    );

    const rows = await repo.findSanctionCandidatesByName('   ');

    expect(rows).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});

interface SelectChain<T> extends PromiseLike<T[]> {
  from: jest.Mock<SelectChain<T>>;
  where: jest.Mock<SelectChain<T>>;
  limit: jest.Mock<Promise<T[]>>;
  catch: Promise<T[]>['catch'];
  finally: Promise<T[]>['finally'];
}

function makeSelectChain<T>(result: T[]): SelectChain<T> {
  const promise = Promise.resolve(result);
  const chain = {} as SelectChain<T>;
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.limit = jest.fn(() => promise);
  chain.then = promise.then.bind(promise);
  chain.catch = promise.catch.bind(promise);
  chain.finally = promise.finally.bind(promise);
  return chain;
}
