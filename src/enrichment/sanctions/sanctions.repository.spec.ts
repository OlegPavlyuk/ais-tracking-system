import { SanctionsRepository } from './sanctions.repository';

describe('SanctionsRepository', () => {
  it('starts an import run through Drizzle and returns the inserted id', async () => {
    const returning = jest.fn().mockResolvedValue([{ id: 42 }]);
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    const repo = makeRepository({ db: { insert } });

    await expect(repo.startRun('ofac')).resolves.toBe(42);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({ source: 'ofac', status: 'running' });
  });

  it('finishes an import run through Drizzle', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const repo = makeRepository({ db: { update } });

    await repo.finishRun(42, 'completed', 3, []);

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        recordsImported: 3,
        errors: [],
      }),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('runs the callback when the source import advisory lock is acquired', async () => {
    const connection = makeConnection([[{ acquired: true }], [{ pg_advisory_unlock: true }]]);
    const dbs = makeDbs(connection);
    const repo = makeRepository(dbs);
    const callback = jest.fn().mockResolvedValue('done');

    const result = await repo.withSourceImportLock('ofac', callback);

    expect(result).toEqual({ acquired: true, result: 'done' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(connection).toHaveBeenCalledTimes(2);
  });

  it('does not run the callback when the source import advisory lock is held', async () => {
    const connection = makeConnection([[{ acquired: false }]]);
    const dbs = makeDbs(connection);
    const repo = makeRepository(dbs);
    const callback = jest.fn();

    const result = await repo.withSourceImportLock('ofac', callback);

    expect(result).toEqual({ acquired: false });
    expect(callback).not.toHaveBeenCalled();
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it('unlocks and releases the reserved connection when the callback throws', async () => {
    const connection = makeConnection([[{ acquired: true }], [{ pg_advisory_unlock: true }]]);
    const dbs = makeDbs(connection);
    const repo = makeRepository(dbs);
    const callback = jest.fn().mockRejectedValue(new Error('import failed'));

    await expect(repo.withSourceImportLock('ofac', callback)).rejects.toThrow('import failed');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(connection).toHaveBeenCalledTimes(2);
  });

  it('detects whether a source has any completed import run', async () => {
    const select = jest.fn(() => makeSelectChain([{ id: 1 }]));
    const dbs = { db: { select } };
    const repo = makeRepository(dbs);

    await expect(repo.hasSuccessfulRunBySource('ofac')).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('maps recent import runs to API row shape', async () => {
    const startedAt = new Date('2026-05-01T00:00:00.000Z');
    const finishedAt = new Date('2026-05-01T00:01:00.000Z');
    const select = jest.fn(() =>
      makeSelectChain([
        {
          id: 42,
          source: 'ofac',
          startedAt,
          finishedAt,
          status: 'completed',
          recordsImported: 3,
          errors: [],
        },
      ]),
    );
    const repo = makeRepository({ db: { select } });

    await expect(repo.findRecentRuns(10)).resolves.toEqual([
      {
        id: 42,
        source: 'ofac',
        startedAt: '2026-05-01T00:00:00.000Z',
        finishedAt: '2026-05-01T00:01:00.000Z',
        status: 'completed',
        recordsImported: 3,
        errors: [],
      },
    ]);
  });

  it('returns null when no latest run exists for a source', async () => {
    const select = jest.fn(() => makeSelectChain([]));
    const repo = makeRepository({ db: { select } });

    await expect(repo.findLastRunBySource('ofac')).resolves.toBeNull();
  });
});

function makeRepository(dbs: unknown): SanctionsRepository {
  const writes = { inc: jest.fn() };
  return new SanctionsRepository(dbs as never, writes as never);
}

function makeDbs(connection: ReturnType<typeof makeConnection>) {
  return {
    db: { execute: jest.fn() },
    withReservedConnection: jest.fn((callback) => callback(connection)),
  };
}

function makeConnection(results: unknown[]) {
  const connection = jest.fn();
  for (const result of results) {
    connection.mockResolvedValueOnce(result);
  }
  return Object.assign(connection, { release: jest.fn() });
}

interface SelectChain<T> extends PromiseLike<T[]> {
  from: jest.Mock<SelectChain<T>>;
  where: jest.Mock<SelectChain<T>>;
  orderBy: jest.Mock<SelectChain<T>>;
  limit: jest.Mock<Promise<T[]>>;
  catch: Promise<T[]>['catch'];
  finally: Promise<T[]>['finally'];
}

function makeSelectChain<T>(result: T[]): SelectChain<T> {
  const promise = Promise.resolve(result);
  const chain = {} as SelectChain<T>;
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => promise);
  chain.then = promise.then.bind(promise);
  chain.catch = promise.catch.bind(promise);
  chain.finally = promise.finally.bind(promise);
  return chain;
}
