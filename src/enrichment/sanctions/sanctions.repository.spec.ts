import { SanctionsRepository } from './sanctions.repository';

describe('SanctionsRepository', () => {
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
    const dbs = { db: { execute: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } };
    const repo = makeRepository(dbs);

    await expect(repo.hasSuccessfulRunBySource('ofac')).resolves.toBe(true);
    expect(dbs.db.execute).toHaveBeenCalledTimes(1);
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
