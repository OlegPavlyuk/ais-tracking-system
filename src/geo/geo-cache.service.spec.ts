import { ConfigService } from '../shared/config/config.service';
import { GeoCacheService } from './geo-cache.service';
import { GeoValidationResult } from './geo-validation.types';

const validEnv = {
  DATABASE_URL: 'postgres://ais:ais@localhost:5432/ais',
  REDIS_URL: 'redis://localhost:6379',
};

function makeRedis() {
  return {
    client: {
      get: jest.fn(),
      set: jest.fn(),
    },
  };
}

describe('GeoCacheService', () => {
  it('includes dataset version and configured precision in cache keys', () => {
    const redis = makeRedis();
    const cache = new GeoCacheService(
      new ConfigService({ ...validEnv, GEO_CACHE_PRECISION: '3' } as NodeJS.ProcessEnv),
      redis as never,
    );

    expect(cache.buildKey('dataset-v7', { lat: 45.12349, lon: 30.98761 })).toBe(
      'geo:validation:dataset-v7:p3:45.123:30.988',
    );
  });

  it('uses a shorter TTL for uncertain verdicts', async () => {
    const redis = makeRedis();
    const cache = new GeoCacheService(
      new ConfigService({
        ...validEnv,
        GEO_CACHE_TTL_SECONDS: '1000',
        GEO_CACHE_UNCERTAIN_TTL_SECONDS: '30',
      } as NodeJS.ProcessEnv),
      redis as never,
    );
    const allowResult: GeoValidationResult = {
      verdict: 'allow',
      reason: 'not_land',
      datasetVersion: 'dataset-v1',
      shouldDrop: false,
    };
    const uncertainResult: GeoValidationResult = {
      verdict: 'uncertain',
      reason: 'coastal_tolerance',
      datasetVersion: 'dataset-v1',
      shouldDrop: false,
    };

    await cache.set('dataset-v1', { lat: 45, lon: 30 }, allowResult);
    await cache.set('dataset-v1', { lat: 45, lon: 30 }, uncertainResult);

    expect(redis.client.set).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      JSON.stringify(allowResult),
      'EX',
      1000,
    );
    expect(redis.client.set).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      JSON.stringify(uncertainResult),
      'EX',
      30,
    );
  });
});
