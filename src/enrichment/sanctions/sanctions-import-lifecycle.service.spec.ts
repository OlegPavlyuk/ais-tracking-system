import { Logger } from '@nestjs/common';
import { SanctionsImportLifecycleService } from './sanctions-import-lifecycle.service';

describe('SanctionsImportLifecycleService', () => {
  it('enqueues a bootstrap job when no successful run exists', async () => {
    const repo = { hasSuccessfulRunBySource: jest.fn().mockResolvedValue(false) };
    const commands = { requestBootstrapRun: jest.fn().mockResolvedValue({ jobId: 'boot-1' }) };
    const service = new SanctionsImportLifecycleService(repo as never, commands as never);

    service.onApplicationBootstrap();
    await flushPromises();

    expect(repo.hasSuccessfulRunBySource).toHaveBeenCalledWith('ofac');
    expect(commands.requestBootstrapRun).toHaveBeenCalledWith('ofac');
  });

  it('skips bootstrap enqueue when a successful run exists', async () => {
    const repo = { hasSuccessfulRunBySource: jest.fn().mockResolvedValue(true) };
    const commands = { requestBootstrapRun: jest.fn() };
    const service = new SanctionsImportLifecycleService(repo as never, commands as never);

    service.onApplicationBootstrap();
    await flushPromises();

    expect(repo.hasSuccessfulRunBySource).toHaveBeenCalledWith('ofac');
    expect(commands.requestBootstrapRun).not.toHaveBeenCalled();
  });

  it('logs and does not throw when bootstrap enqueue fails', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const repo = { hasSuccessfulRunBySource: jest.fn().mockResolvedValue(false) };
    const commands = {
      requestBootstrapRun: jest.fn().mockRejectedValue(new Error('redis offline')),
    };
    const service = new SanctionsImportLifecycleService(repo as never, commands as never);

    try {
      expect(service.onApplicationBootstrap()).toBeUndefined();
      await flushPromises();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('sanctions bootstrap failed source=ofac'),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
