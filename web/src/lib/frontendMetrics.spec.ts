import { beforeEach, describe, expect, it } from 'vitest';
import {
  frontendMetrics,
  recordRealtimeMessage,
  recordVesselSourceUpdate,
} from './frontendMetrics';

describe('frontendMetrics', () => {
  beforeEach(() => {
    frontendMetrics().reset();
  });

  it('records realtime message counters by kind', () => {
    recordRealtimeMessage('position');
    recordRealtimeMessage('position');
    recordRealtimeMessage('static');
    recordRealtimeMessage('vessel.enriched');
    recordRealtimeMessage('error');

    expect(frontendMetrics().realtime).toEqual({
      totalMessages: 5,
      positionMessages: 2,
      staticMessages: 1,
      enrichedMessages: 1,
      errorMessages: 1,
    });
  });

  it('records vessel source update timing and count context', () => {
    recordVesselSourceUpdate({
      buildDurationMs: 1.5,
      setDataDurationMs: 2,
      vesselCount: 10,
      featureCount: 8,
    });
    recordVesselSourceUpdate({
      buildDurationMs: 3,
      setDataDurationMs: 0.5,
      vesselCount: 12,
      featureCount: 9,
    });

    expect(frontendMetrics().vesselSourceUpdates).toEqual({
      flushCount: 2,
      totalBuildDurationMs: 4.5,
      totalSetDataDurationMs: 2.5,
      avgBuildDurationMs: 2.25,
      avgSetDataDurationMs: 1.25,
      maxBuildDurationMs: 3,
      maxSetDataDurationMs: 2,
      maxVesselCount: 12,
      maxFeatureCount: 9,
      lastBuildDurationMs: 3,
      lastSetDataDurationMs: 0.5,
      lastVesselCount: 12,
      lastFeatureCount: 9,
    });
  });

  it('resets average and maximum source update metrics', () => {
    recordVesselSourceUpdate({
      buildDurationMs: 1,
      setDataDurationMs: 2,
      vesselCount: 10,
      featureCount: 8,
    });

    frontendMetrics().reset();

    expect(frontendMetrics().vesselSourceUpdates.avgBuildDurationMs).toBe(0);
    expect(frontendMetrics().vesselSourceUpdates.avgSetDataDurationMs).toBe(0);
    expect(frontendMetrics().vesselSourceUpdates.maxVesselCount).toBe(0);
    expect(frontendMetrics().vesselSourceUpdates.maxFeatureCount).toBe(0);
  });
});
