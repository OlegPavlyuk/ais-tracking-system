import { Counter } from 'prom-client';
import { EventBus } from '../shared/bus/event-bus';
import { AIS_EVENTS_STREAM } from '../shared/config/constants';
import { stubCounter, stubPinoLogger } from '../shared/testing/metrics-stubs';
import {
  CanonicalEvent,
  PositionEvent,
  RawProviderMessage,
  SCHEMA_VERSION,
  StaticEvent,
} from '../contracts';
import { ProviderNormalizer } from '../ingestion/provider';
import { ProviderRegistry } from '../ingestion/provider-registry';
import { GeoValidationService } from '../geo/geo-validation.service';
import { DedupService } from './dedup.service';
import { IngestionPipelineService } from './ingestion-pipeline.service';
import { SamplerService } from './sampler.service';

function position(overrides: Partial<PositionEvent> = {}): PositionEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'position',
    mmsi: '241935000',
    lat: 41.5,
    lon: 41.5,
    sog: 5,
    cog: 100,
    trueHeading: 100,
    navStatus: 0,
    rateOfTurn: 0,
    shipName: 'TEST',
    occurredAt: '2026-04-28T05:00:00.000Z',
    provider: 'aisstream',
    ingestedAt: '2026-04-28T05:00:00.000Z',
    ...overrides,
  };
}

function staticEvent(overrides: Partial<StaticEvent> = {}): StaticEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'static',
    mmsi: '241935000',
    name: 'TEST',
    occurredAt: '2026-04-28T05:00:00.000Z',
    provider: 'aisstream',
    ingestedAt: '2026-04-28T05:00:00.000Z',
    ...overrides,
  };
}

function raw(): RawProviderMessage<unknown> {
  return {
    provider: 'aisstream',
    receivedAt: '2026-04-28T05:00:00.000Z',
    payload: {},
  };
}

function makeHarness(event: PositionEvent | StaticEvent | null) {
  let messageHandler: ((raw: RawProviderMessage<unknown>) => void) | undefined;
  const adapter = {
    id: 'aisstream',
    start: jest.fn(),
    stop: jest.fn(),
    onMessage: jest.fn((handler: (raw: RawProviderMessage<unknown>) => void) => {
      messageHandler = handler;
    }),
    health: jest.fn(),
  };
  const normalizer: ProviderNormalizer = {
    provider: 'aisstream',
    normalize: jest.fn(() => event),
  };
  const registry = {
    providers: jest.fn(() => [{ adapter, normalizer }]),
  } as unknown as ProviderRegistry;
  const dedup = {
    shouldAccept: jest.fn().mockResolvedValue(true),
  } as unknown as DedupService;
  const sampler = {
    shouldEmit: jest.fn().mockResolvedValue(true),
  } as unknown as SamplerService;
  const geoValidation = {
    validatePosition: jest.fn().mockResolvedValue({
      verdict: 'allow',
      reason: 'not_land',
      datasetVersion: 'dataset-v1',
      shouldDrop: false,
    }),
  } as unknown as GeoValidationService;
  const bus = {
    publish: jest.fn().mockResolvedValue(undefined),
  } as unknown as EventBus;
  const droppedCounter = stubCounter() as Counter<'reason'>;
  const receivedCounter = stubCounter() as Counter<'provider'>;
  const publishedCounter = stubCounter() as Counter<'stream' | 'kind'>;
  const service = new IngestionPipelineService(
    registry,
    dedup,
    sampler,
    geoValidation,
    bus,
    droppedCounter,
    receivedCounter,
    publishedCounter,
    stubPinoLogger(),
  );

  service.onModuleInit();

  return {
    adapter,
    normalizer,
    dedup,
    sampler,
    geoValidation,
    bus,
    droppedCounter,
    receivedCounter,
    publishedCounter,
    emit: async () => {
      if (!messageHandler) {
        throw new Error('provider message handler was not registered');
      }
      messageHandler(raw());
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('IngestionPipelineService geo validation integration', () => {
  it('bypasses geo validation for static events', async () => {
    const h = makeHarness(staticEvent());

    await h.emit();

    expect(h.geoValidation.validatePosition).not.toHaveBeenCalled();
    expect(h.sampler.shouldEmit).not.toHaveBeenCalled();
    expect(h.bus.publish).toHaveBeenCalledWith(
      AIS_EVENTS_STREAM,
      expect.objectContaining({ kind: 'static', traceId: expect.any(String) }),
    );
  });

  it('calls geo validation only after bbox passes and before sampler with the published trace id', async () => {
    const h = makeHarness(position());
    const order: string[] = [];
    jest.spyOn(h.geoValidation, 'validatePosition').mockImplementation(async () => {
      order.push('geo');
      return {
        verdict: 'allow',
        reason: 'not_land',
        datasetVersion: 'dataset-v1',
        shouldDrop: false,
      };
    });
    jest.spyOn(h.sampler, 'shouldEmit').mockImplementation(async () => {
      order.push('sampler');
      return true;
    });

    await h.emit();

    expect(h.geoValidation.validatePosition).toHaveBeenCalledWith({
      lat: 41.5,
      lon: 41.5,
      mmsi: '241935000',
      provider: 'aisstream',
      traceId: expect.any(String),
    });
    expect(order).toEqual(['geo', 'sampler']);
    const geoTraceId = jest.mocked(h.geoValidation.validatePosition).mock.calls[0]?.[0].traceId;
    const samplerTraceId = jest.mocked(h.sampler.shouldEmit).mock.calls[0]?.[0].traceId;
    const publishedEvent = jest.mocked(h.bus.publish).mock.calls[0]?.[1] as CanonicalEvent;
    const publishedTraceId = publishedEvent.traceId;
    expect(samplerTraceId).toBe(geoTraceId);
    expect(publishedTraceId).toBe(geoTraceId);
  });

  it('reuses an upstream trace id for geo validation and publish', async () => {
    const traceId = '11111111-1111-4111-8111-111111111111';
    const h = makeHarness(position({ traceId }));

    await h.emit();

    expect(h.geoValidation.validatePosition).toHaveBeenCalledWith(
      expect.objectContaining({ traceId }),
    );
    expect(h.sampler.shouldEmit).toHaveBeenCalledWith(expect.objectContaining({ traceId }));
    expect(h.bus.publish).toHaveBeenCalledWith(
      AIS_EVENTS_STREAM,
      expect.objectContaining({ traceId }),
    );
  });

  it('does not call geo validation for out-of-bbox positions', async () => {
    const h = makeHarness(position({ lat: 10, lon: 10 }));
    const dropped = jest.spyOn(h.droppedCounter, 'inc');

    await h.emit();

    expect(h.geoValidation.validatePosition).not.toHaveBeenCalled();
    expect(h.sampler.shouldEmit).not.toHaveBeenCalled();
    expect(h.bus.publish).not.toHaveBeenCalled();
    expect(dropped).toHaveBeenCalledWith({ reason: 'out_of_bbox' });
  });

  it('drops deep-land rejects as on_land before sampler and publish', async () => {
    const h = makeHarness(position());
    const dropped = jest.spyOn(h.droppedCounter, 'inc');
    jest.spyOn(h.geoValidation, 'validatePosition').mockResolvedValue({
      verdict: 'reject',
      reason: 'deep_land',
      datasetVersion: 'dataset-v1',
      shouldDrop: true,
    });

    await h.emit();

    expect(dropped).toHaveBeenCalledWith({ reason: 'on_land' });
    expect(h.sampler.shouldEmit).not.toHaveBeenCalled();
    expect(h.bus.publish).not.toHaveBeenCalled();
  });

  it('drops fail-closed geo validation errors with geo_validation_error reason', async () => {
    const h = makeHarness(position());
    const dropped = jest.spyOn(h.droppedCounter, 'inc');
    jest.spyOn(h.geoValidation, 'validatePosition').mockResolvedValue({
      verdict: 'reject',
      reason: 'geo_validation_error',
      datasetVersion: null,
      shouldDrop: true,
    });

    await h.emit();

    expect(dropped).toHaveBeenCalledWith({ reason: 'geo_validation_error' });
    expect(h.sampler.shouldEmit).not.toHaveBeenCalled();
    expect(h.bus.publish).not.toHaveBeenCalled();
  });

  it('passes uncertain coastal tolerance verdicts through sampler and publish', async () => {
    const h = makeHarness(position());
    jest.spyOn(h.geoValidation, 'validatePosition').mockResolvedValue({
      verdict: 'uncertain',
      reason: 'coastal_tolerance',
      datasetVersion: 'dataset-v1',
      shouldDrop: false,
    });

    await h.emit();

    expect(h.sampler.shouldEmit).toHaveBeenCalled();
    expect(h.bus.publish).toHaveBeenCalledWith(
      AIS_EVENTS_STREAM,
      expect.objectContaining({ kind: 'position', traceId: expect.any(String) }),
    );
  });
});
