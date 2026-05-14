import { VesselsRepository } from './vessels.repository';
import { SCHEMA_VERSION, PositionEvent, StaticEvent } from '../contracts';
import { ConfigService } from '../shared/config/config.service';
import { stubCounter, stubHistogram, stubPinoLogger } from '../shared/testing/metrics-stubs';

describe('VesselsRepository', () => {
  function positionEvent(overrides: Partial<PositionEvent> = {}): PositionEvent {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'position',
      mmsi: '241935000',
      lat: 41.5,
      lon: 41.5,
      sog: 0.1,
      cog: 26.9,
      trueHeading: 261,
      navStatus: 5,
      rateOfTurn: 0,
      shipName: 'SEA MOON',
      occurredAt: '2000-01-01T00:00:00.000Z',
      provider: 'aisstream',
      ingestedAt: '2026-05-14T12:00:00.000Z',
      traceId: '11111111-2222-4333-8444-555555555555',
      ...overrides,
    };
  }

  function staticEvent(overrides: Partial<StaticEvent> = {}): StaticEvent {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'static',
      mmsi: '241935000',
      imo: '9187629',
      name: 'SEA MOON',
      occurredAt: '2000-01-01T00:00:00.000Z',
      provider: 'aisstream',
      ingestedAt: '2026-05-14T12:00:00.000Z',
      traceId: '11111111-2222-4333-8444-555555555555',
      ...overrides,
    };
  }

  function repo(txExecute: jest.Mock, historyDropped = stubCounter(), logger = stubPinoLogger()) {
    const dbs = {
      db: {
        transaction: jest.fn(async (cb) => cb({ execute: txExecute })),
      },
    };
    const config = {
      get: (key: string) => {
        if (key === 'HISTORY_RETENTION_DAYS') return 7;
        throw new Error(`unexpected config key ${key}`);
      },
    } as unknown as ConfigService;
    return new VesselsRepository(
      dbs as never,
      config,
      stubHistogram(),
      stubCounter(),
      historyDropped,
      logger,
    );
  }

  it('drops stale position telemetry before any DB write', async () => {
    const historyDropped = stubCounter();
    const droppedSpy = jest.spyOn(historyDropped, 'inc');
    const logger = stubPinoLogger();
    const warnSpy = jest.spyOn(logger, 'warn');
    const txExecute = jest.fn();

    await repo(txExecute, historyDropped, logger).upsertPosition(positionEvent());

    expect(txExecute).not.toHaveBeenCalled();
    expect(droppedSpy).toHaveBeenCalledWith({ reason: 'too_old' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mmsi: '241935000',
        occurredAt: '2000-01-01T00:00:00.000Z',
        retentionCutoff: expect.any(String),
        traceId: '11111111-2222-4333-8444-555555555555',
        kind: 'position',
        reason: 'too_old',
      }),
      'dropped stale telemetry outside retention window',
    );
  });

  it('drops stale static telemetry before any DB write', async () => {
    const historyDropped = stubCounter();
    const droppedSpy = jest.spyOn(historyDropped, 'inc');
    const logger = stubPinoLogger();
    const warnSpy = jest.spyOn(logger, 'warn');
    const txExecute = jest.fn();

    await repo(txExecute, historyDropped, logger).upsertProfile(staticEvent());

    expect(txExecute).not.toHaveBeenCalled();
    expect(droppedSpy).toHaveBeenCalledWith({ reason: 'too_old' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mmsi: '241935000',
        occurredAt: '2000-01-01T00:00:00.000Z',
        retentionCutoff: expect.any(String),
        traceId: '11111111-2222-4333-8444-555555555555',
        kind: 'static',
        reason: 'too_old',
      }),
      'dropped stale telemetry outside retention window',
    );
  });

  it('writes history for events inside retention', async () => {
    const historyDropped = stubCounter();
    const droppedSpy = jest.spyOn(historyDropped, 'inc');
    const txExecute = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await repo(txExecute, historyDropped).upsertPosition(
      positionEvent({ occurredAt: new Date().toISOString() }),
    );

    expect(txExecute).toHaveBeenCalledTimes(3);
    expect(droppedSpy).not.toHaveBeenCalled();
  });
});
