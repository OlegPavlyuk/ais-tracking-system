import { ConfigService } from './config.service';

const validEnv = {
  DATABASE_URL: 'postgres://ais:ais@localhost:5432/ais',
  REDIS_URL: 'redis://localhost:6379',
};

describe('ConfigService', () => {
  it('applies defaults when only required fields are present', () => {
    const config = new ConfigService(validEnv as NodeJS.ProcessEnv);
    expect(config.get('NODE_ENV')).toBe('development');
    expect(config.get('PROCESS_ROLE')).toBe('all');
    expect(config.get('PORT')).toBe(3000);
    expect(config.get('LOG_LEVEL')).toBe('info');
    expect(config.get('METRICS_ENABLED')).toBe(true);
    expect(config.get('AIS_PROVIDERS')).toEqual(['aisstream']);
    expect(config.get('GEO_VALIDATION_ENABLED')).toBe(true);
    expect(config.get('GEO_VALIDATION_FAIL_OPEN')).toBe(true);
    expect(config.get('GEO_COASTAL_TOLERANCE_METERS')).toBe(500);
    expect(config.get('GEO_COVERAGE_MARGIN_KM')).toBe(50);
    expect(config.get('GEO_CACHE_ENABLED')).toBe(true);
    expect(config.get('GEO_CACHE_PRECISION')).toBe(4);
    expect(config.get('GEO_CACHE_TTL_SECONDS')).toBe(7 * 24 * 60 * 60);
    expect(config.get('GEO_CACHE_UNCERTAIN_TTL_SECONDS')).toBe(30 * 60);
    expect(config.get('WS_SEND_QUEUE_MAX')).toBe(256);
    expect(config.get('WS_BUFFERED_AMOUNT_LIMIT_BYTES')).toBe(1024 * 1024);
    expect(config.get('WS_HEARTBEAT_INTERVAL_MS')).toBe(30_000);
    expect(config.get('ENRICHMENT_RECONCILIATION_INTERVAL_MS')).toBe(30 * 60 * 1000);
    expect(config.get('ENRICHMENT_RECONCILIATION_BATCH_SIZE')).toBe(500);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => new ConfigService({ REDIS_URL: 'redis://x' } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws when DATABASE_URL is not a URL', () => {
    expect(
      () =>
        new ConfigService({ ...validEnv, DATABASE_URL: 'not-a-url' } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when PROCESS_ROLE is invalid', () => {
    expect(
      () =>
        new ConfigService({ ...validEnv, PROCESS_ROLE: 'banana' } as NodeJS.ProcessEnv),
    ).toThrow(/PROCESS_ROLE/);
  });

  it('parses PORT as a number', () => {
    const config = new ConfigService({ ...validEnv, PORT: '4001' } as NodeJS.ProcessEnv);
    expect(config.get('PORT')).toBe(4001);
  });

  it('splits AIS_PROVIDERS into a list', () => {
    const config = new ConfigService({
      ...validEnv,
      AIS_PROVIDERS: 'aisstream, marinetraffic',
    } as NodeJS.ProcessEnv);
    expect(config.get('AIS_PROVIDERS')).toEqual(['aisstream', 'marinetraffic']);
  });

  it('parses METRICS_ENABLED=false', () => {
    const config = new ConfigService({
      ...validEnv,
      METRICS_ENABLED: 'false',
    } as NodeJS.ProcessEnv);
    expect(config.get('METRICS_ENABLED')).toBe(false);
  });

  it('parses geo boolean flags', () => {
    const config = new ConfigService({
      ...validEnv,
      GEO_VALIDATION_ENABLED: 'false',
      GEO_VALIDATION_FAIL_OPEN: 'false',
      GEO_CACHE_ENABLED: 'false',
    } as NodeJS.ProcessEnv);
    expect(config.get('GEO_VALIDATION_ENABLED')).toBe(false);
    expect(config.get('GEO_VALIDATION_FAIL_OPEN')).toBe(false);
    expect(config.get('GEO_CACHE_ENABLED')).toBe(false);
  });

  it('throws when geo boolean flags are invalid', () => {
    expect(
      () =>
        new ConfigService({
          ...validEnv,
          GEO_VALIDATION_ENABLED: 'sometimes',
        } as NodeJS.ProcessEnv),
    ).toThrow(/GEO_VALIDATION_ENABLED/);
  });

  it('throws when geo numeric settings are invalid', () => {
    expect(
      () =>
        new ConfigService({
          ...validEnv,
          GEO_CACHE_PRECISION: '-1',
        } as NodeJS.ProcessEnv),
    ).toThrow(/GEO_CACHE_PRECISION/);
    expect(
      () =>
        new ConfigService({
          ...validEnv,
          GEO_COASTAL_TOLERANCE_METERS: '0',
        } as NodeJS.ProcessEnv),
    ).toThrow(/GEO_COASTAL_TOLERANCE_METERS/);
  });
});
