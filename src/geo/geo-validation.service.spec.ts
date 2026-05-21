import { ConfigService } from '../shared/config/config.service';
import {
  stubCounter,
  stubGauge,
  stubHistogram,
  stubPinoLogger,
} from '../shared/testing/metrics-stubs';
import { GeoCacheService } from './geo-cache.service';
import { GeoDatasetRepository } from './geo-dataset.repository';
import { GeoValidationService } from './geo-validation.service';
import { GeoValidationResult } from './geo-validation.types';

const validEnv = {
  DATABASE_URL: 'postgres://ais:ais@localhost:5432/ais',
  REDIS_URL: 'redis://localhost:6379',
};

function makeService(overrides: {
  env?: Record<string, string>;
  repository?: Partial<GeoDatasetRepository>;
  cache?: Partial<GeoCacheService>;
  validationCounter?: ReturnType<typeof stubCounter>;
  cacheCounter?: ReturnType<typeof stubCounter>;
  activeDatasetGauge?: ReturnType<typeof stubGauge>;
  pino?: ReturnType<typeof stubPinoLogger>;
}) {
  const repository = {
    getActiveDatasetVersion: jest.fn().mockResolvedValue('dataset-v1'),
    validatePosition: jest.fn().mockResolvedValue({
      verdict: 'allow',
      reason: 'not_land',
      datasetVersion: 'dataset-v1',
    }),
    ...overrides.repository,
  } as unknown as GeoDatasetRepository;
  const cache = {
    isEnabled: jest.fn().mockReturnValue(true),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    ...overrides.cache,
  } as unknown as GeoCacheService;
  const validationCounter = overrides.validationCounter ?? stubCounter();
  const cacheCounter = overrides.cacheCounter ?? stubCounter();
  const activeDatasetGauge = overrides.activeDatasetGauge ?? stubGauge();
  const pino = overrides.pino ?? stubPinoLogger();
  const service = new GeoValidationService(
    new ConfigService({ ...validEnv, ...overrides.env } as NodeJS.ProcessEnv),
    repository,
    cache,
    validationCounter,
    cacheCounter,
    stubHistogram(),
    activeDatasetGauge,
    pino,
  );

  return { service, repository, cache, validationCounter, cacheCounter, activeDatasetGauge, pino };
}

describe('GeoValidationService', () => {
  it('returns cached results before querying PostGIS', async () => {
    const cached: GeoValidationResult = {
      verdict: 'reject',
      reason: 'deep_land',
      datasetVersion: 'dataset-v1',
      shouldDrop: true,
    };
    const { service, repository, cache } = makeService({
      cache: {
        get: jest.fn().mockResolvedValue(cached),
      },
    });

    await expect(service.validatePosition({ lat: 45, lon: 30 })).resolves.toEqual(cached);
    expect(repository.getActiveDatasetVersion).toHaveBeenCalledTimes(1);
    expect(cache.get).toHaveBeenCalledWith('dataset-v1', { lat: 45, lon: 30 });
    expect(repository.validatePosition).not.toHaveBeenCalled();
  });

  it('queries PostGIS on cache miss and caches the structured result', async () => {
    const { service, repository, cache } = makeService({
      repository: {
        validatePosition: jest.fn().mockResolvedValue({
          verdict: 'uncertain',
          reason: 'coastal_tolerance',
          datasetVersion: 'dataset-v1',
        }),
      },
    });

    await expect(service.validatePosition({ lat: 45, lon: 30 })).resolves.toEqual({
      verdict: 'uncertain',
      reason: 'coastal_tolerance',
      datasetVersion: 'dataset-v1',
      shouldDrop: false,
    });
    expect(repository.validatePosition).toHaveBeenCalledWith(30, 45);
    expect(cache.set).toHaveBeenCalledWith('dataset-v1', { lat: 45, lon: 30 }, expect.any(Object));
  });

  it('caches under the SQL result dataset version if activation changes mid-validation', async () => {
    const { service, cache } = makeService({
      repository: {
        getActiveDatasetVersion: jest.fn().mockResolvedValue('dataset-v1'),
        validatePosition: jest.fn().mockResolvedValue({
          verdict: 'allow',
          reason: 'not_land',
          datasetVersion: 'dataset-v2',
        }),
      },
    });

    await expect(service.validatePosition({ lat: 45, lon: 30 })).resolves.toMatchObject({
      verdict: 'allow',
      reason: 'not_land',
      datasetVersion: 'dataset-v2',
      shouldDrop: false,
    });
    expect(cache.get).toHaveBeenCalledWith('dataset-v1', { lat: 45, lon: 30 });
    expect(cache.set).toHaveBeenCalledWith('dataset-v2', { lat: 45, lon: 30 }, expect.any(Object));
  });

  it('marks deep-land rejects as droppable', async () => {
    const { service } = makeService({
      repository: {
        validatePosition: jest.fn().mockResolvedValue({
          verdict: 'reject',
          reason: 'deep_land',
          datasetVersion: 'dataset-v1',
        }),
      },
    });

    await expect(service.validatePosition({ lat: 45, lon: 30 })).resolves.toMatchObject({
      verdict: 'reject',
      reason: 'deep_land',
      shouldDrop: true,
    });
  });

  it('keeps invalid coordinate rejects non-droppable for Phase 5 reason-aware mapping', async () => {
    const { service } = makeService({
      repository: {
        validatePosition: jest.fn().mockResolvedValue({
          verdict: 'reject',
          reason: 'invalid_coordinates',
          datasetVersion: null,
        }),
      },
    });

    await expect(service.validatePosition({ lat: 91, lon: 30 })).resolves.toMatchObject({
      verdict: 'reject',
      reason: 'invalid_coordinates',
      shouldDrop: false,
    });
  });

  it('fail-opens with metrics on repository errors by default', async () => {
    const validationCounter = stubCounter();
    const inc = jest.spyOn(validationCounter, 'inc');
    const { service } = makeService({
      validationCounter,
      repository: {
        getActiveDatasetVersion: jest.fn().mockRejectedValue(new Error('db down')),
      },
    });

    await expect(service.validatePosition({ lat: 45, lon: 30 })).resolves.toEqual({
      verdict: 'allow',
      reason: 'geo_validation_error',
      datasetVersion: null,
      shouldDrop: false,
    });
    expect(inc).toHaveBeenCalledWith({
      verdict: 'allow',
      reason: 'geo_validation_error',
      source: 'error',
    });
  });

  it('fail-closes with geo_validation_error when configured', async () => {
    const { service } = makeService({
      env: { GEO_VALIDATION_FAIL_OPEN: 'false' },
      repository: {
        getActiveDatasetVersion: jest.fn().mockRejectedValue(new Error('db down')),
      },
    });

    await expect(service.validatePosition({ lat: 45, lon: 30 })).resolves.toEqual({
      verdict: 'reject',
      reason: 'geo_validation_error',
      datasetVersion: null,
      shouldDrop: true,
    });
  });

  it('bypasses repository and cache when disabled and logs only once', async () => {
    const pino = stubPinoLogger();
    const info = jest.spyOn(pino, 'info');
    const { service, repository, cache } = makeService({
      env: { GEO_VALIDATION_ENABLED: 'false' },
      pino,
    });

    await expect(service.validatePosition({ lat: 45, lon: 30 })).resolves.toEqual({
      verdict: 'allow',
      reason: 'disabled',
      datasetVersion: null,
      shouldDrop: false,
    });
    await expect(service.validatePosition({ lat: 46, lon: 31 })).resolves.toEqual({
      verdict: 'allow',
      reason: 'disabled',
      datasetVersion: null,
      shouldDrop: false,
    });
    expect(repository.getActiveDatasetVersion).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 45, lon: 30 }),
      'geo validation disabled',
    );
  });

  it('removes the previous active dataset metric label after a version swap', async () => {
    const activeDatasetGauge = stubGauge();
    const set = jest.spyOn(activeDatasetGauge, 'set');
    const remove = jest.spyOn(activeDatasetGauge, 'remove');
    const getActiveDatasetVersion = jest
      .fn()
      .mockResolvedValueOnce('dataset-v1')
      .mockResolvedValueOnce('dataset-v2');
    const { service } = makeService({
      activeDatasetGauge,
      repository: { getActiveDatasetVersion },
    });

    await service.validatePosition({ lat: 45, lon: 30 });
    await service.validatePosition({ lat: 45, lon: 30 });

    expect(set).toHaveBeenCalledWith({ version: 'dataset-v1' }, 1);
    expect(remove).toHaveBeenCalledWith({ version: 'dataset-v1' });
    expect(set).toHaveBeenCalledWith({ version: 'dataset-v2' }, 1);
  });

  it('clears the previous active dataset metric label when no dataset is active', async () => {
    const activeDatasetGauge = stubGauge();
    const remove = jest.spyOn(activeDatasetGauge, 'remove');
    const getActiveDatasetVersion = jest
      .fn()
      .mockResolvedValueOnce('dataset-v1')
      .mockResolvedValueOnce(null);
    const { service } = makeService({
      activeDatasetGauge,
      repository: {
        getActiveDatasetVersion,
        validatePosition: jest.fn().mockResolvedValue({
          verdict: 'allow',
          reason: 'dataset_unavailable',
          datasetVersion: null,
        }),
      },
    });

    await service.validatePosition({ lat: 45, lon: 30 });
    await service.validatePosition({ lat: 45, lon: 30 });

    expect(remove).toHaveBeenCalledWith({ version: 'dataset-v1' });
  });
});
