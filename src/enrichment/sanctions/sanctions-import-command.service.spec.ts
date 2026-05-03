import { SanctionsImportCommandService } from './sanctions-import-command.service';

describe('SanctionsImportCommandService', () => {
  it('enqueues a manual job named "<source>.manual" with retention options and returns the job id', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'bull-42' });
    const queue = { add } as unknown as Parameters<typeof makeService>[0];
    const svc = makeService(queue);

    const result = await svc.requestRun('ofac');

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'ofac.manual',
      { source: 'ofac' },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    expect(result).toEqual({ jobId: 'bull-42' });
  });

  it('coerces a numeric job id to a string', async () => {
    const add = jest.fn().mockResolvedValue({ id: 17 });
    const svc = makeService({ add } as never);
    const result = await svc.requestRun('ofac');
    expect(result.jobId).toBe('17');
  });
});

function makeService(queue: { add: jest.Mock }): SanctionsImportCommandService {
  return new SanctionsImportCommandService(queue as never);
}
