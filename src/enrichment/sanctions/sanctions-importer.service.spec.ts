import { SanctionsImporterService } from './sanctions-importer.service';
import { SanctionsSourceAdapter, VesselEntity } from './sanctions-source.adapter';

describe('SanctionsImporterService', () => {
  it('imports entities when the source advisory lock is acquired', async () => {
    const repo = makeRepo();
    repo.withSourceImportLock.mockImplementation(async (_source, callback) => ({
      acquired: true,
      result: await callback(),
    }));
    const { importer, endTimer } = makeImporter(repo);
    const adapter = makeAdapter([
      entity('1', 'A'),
      entity('2', 'B'),
      entity('3', 'C'),
    ]);

    const result = await importer.run(adapter);

    expect(repo.withSourceImportLock).toHaveBeenCalledWith('ofac', expect.any(Function));
    expect(repo.startRun).toHaveBeenCalledWith('ofac');
    expect(repo.upsertEntities).toHaveBeenCalledTimes(2);
    expect(repo.finishRun).toHaveBeenCalledWith(42, 'completed', 3, []);
    expect(endTimer).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ runId: 42, status: 'completed', recordsImported: 3 });
  });

  it('skips without starting a run when another process holds the source lock', async () => {
    const repo = makeRepo();
    repo.withSourceImportLock.mockResolvedValue({ acquired: false });
    const { importer } = makeImporter(repo);

    const result = await importer.run(makeAdapter([entity('1', 'A')]));

    expect(repo.startRun).not.toHaveBeenCalled();
    expect(repo.upsertEntities).not.toHaveBeenCalled();
    expect(repo.finishRun).not.toHaveBeenCalled();
    expect(result).toEqual({ runId: null, status: 'skipped', recordsImported: 0, errors: [] });
  });

  it('preserves the original import error when marking the run as failed also fails', async () => {
    const repo = makeRepo();
    repo.withSourceImportLock.mockImplementation(async (_source, callback) => ({
      acquired: true,
      result: await callback(),
    }));
    repo.upsertEntities.mockRejectedValueOnce(new Error('source parse failed'));
    repo.finishRun.mockRejectedValueOnce(new Error('audit update failed'));
    const { importer, endTimer } = makeImporter(repo);

    await expect(importer.run(makeAdapter([entity('1', 'A'), entity('2', 'B')]))).rejects.toThrow(
      'source parse failed',
    );

    expect(repo.finishRun).toHaveBeenCalledWith(42, 'failed', 0, [
      { message: 'source parse failed' },
    ]);
    expect(endTimer).toHaveBeenCalledTimes(1);
  });
});

function makeImporter(repo: ReturnType<typeof makeRepo>): {
  importer: SanctionsImporterService;
  endTimer: jest.Mock;
} {
  const config = { get: jest.fn().mockReturnValue(2) };
  const endTimer = jest.fn();
  const importDuration = { startTimer: jest.fn(() => endTimer) };
  const importRecords = { inc: jest.fn() };
  return {
    importer: new SanctionsImporterService(
      repo as never,
      config as never,
      importDuration as never,
      importRecords as never,
    ),
    endTimer,
  };
}

function makeRepo() {
  return {
    withSourceImportLock: jest.fn(),
    startRun: jest.fn().mockResolvedValue(42),
    upsertEntities: jest.fn().mockResolvedValue(undefined),
    finishRun: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAdapter(entities: VesselEntity[]): SanctionsSourceAdapter {
  return {
    source: 'ofac',
    async *fetchAll() {
      yield* entities;
    },
  };
}

function entity(sourceEntityId: string, name: string): VesselEntity {
  return {
    sourceEntityId,
    name,
    imo: null,
    mmsi: null,
    aliases: [],
    flag: null,
    listingDate: null,
    programs: [],
    rawPayload: { sourceEntityId },
  };
}
