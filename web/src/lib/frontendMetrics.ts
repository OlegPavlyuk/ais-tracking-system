type RealtimeMessageKind = 'position' | 'static' | 'vessel.enriched' | 'error';

interface RealtimeMessageMetrics {
  totalMessages: number;
  positionMessages: number;
  staticMessages: number;
  enrichedMessages: number;
  errorMessages: number;
}

interface VesselSourceUpdateMetrics {
  flushCount: number;
  totalBuildDurationMs: number;
  totalSetDataDurationMs: number;
  avgBuildDurationMs: number;
  avgSetDataDurationMs: number;
  maxBuildDurationMs: number;
  maxSetDataDurationMs: number;
  maxVesselCount: number;
  maxFeatureCount: number;
  lastBuildDurationMs: number;
  lastSetDataDurationMs: number;
  lastVesselCount: number;
  lastFeatureCount: number;
}

export interface FrontendMetrics {
  realtime: RealtimeMessageMetrics;
  vesselSourceUpdates: VesselSourceUpdateMetrics;
  reset: () => void;
}

const METRICS_KEY = '__AIS_FRONTEND_METRICS__';

function resetMetrics(metrics: FrontendMetrics): void {
  metrics.realtime.totalMessages = 0;
  metrics.realtime.positionMessages = 0;
  metrics.realtime.staticMessages = 0;
  metrics.realtime.enrichedMessages = 0;
  metrics.realtime.errorMessages = 0;

  metrics.vesselSourceUpdates.flushCount = 0;
  metrics.vesselSourceUpdates.totalBuildDurationMs = 0;
  metrics.vesselSourceUpdates.totalSetDataDurationMs = 0;
  metrics.vesselSourceUpdates.avgBuildDurationMs = 0;
  metrics.vesselSourceUpdates.avgSetDataDurationMs = 0;
  metrics.vesselSourceUpdates.maxBuildDurationMs = 0;
  metrics.vesselSourceUpdates.maxSetDataDurationMs = 0;
  metrics.vesselSourceUpdates.maxVesselCount = 0;
  metrics.vesselSourceUpdates.maxFeatureCount = 0;
  metrics.vesselSourceUpdates.lastBuildDurationMs = 0;
  metrics.vesselSourceUpdates.lastSetDataDurationMs = 0;
  metrics.vesselSourceUpdates.lastVesselCount = 0;
  metrics.vesselSourceUpdates.lastFeatureCount = 0;
}

function createMetrics(): FrontendMetrics {
  const metrics: FrontendMetrics = {
    realtime: {
      totalMessages: 0,
      positionMessages: 0,
      staticMessages: 0,
      enrichedMessages: 0,
      errorMessages: 0,
    },
    vesselSourceUpdates: {
      flushCount: 0,
      totalBuildDurationMs: 0,
      totalSetDataDurationMs: 0,
      avgBuildDurationMs: 0,
      avgSetDataDurationMs: 0,
      maxBuildDurationMs: 0,
      maxSetDataDurationMs: 0,
      maxVesselCount: 0,
      maxFeatureCount: 0,
      lastBuildDurationMs: 0,
      lastSetDataDurationMs: 0,
      lastVesselCount: 0,
      lastFeatureCount: 0,
    },
    reset: () => resetMetrics(metrics),
  };
  return metrics;
}

export function frontendMetrics(): FrontendMetrics {
  const target = globalThis as typeof globalThis & {
    [METRICS_KEY]?: FrontendMetrics;
  };
  target[METRICS_KEY] ??= createMetrics();
  return target[METRICS_KEY];
}

export function recordRealtimeMessage(kind: RealtimeMessageKind): void {
  const metrics = frontendMetrics().realtime;
  metrics.totalMessages += 1;
  switch (kind) {
    case 'position':
      metrics.positionMessages += 1;
      break;
    case 'static':
      metrics.staticMessages += 1;
      break;
    case 'vessel.enriched':
      metrics.enrichedMessages += 1;
      break;
    case 'error':
      metrics.errorMessages += 1;
      break;
  }
}

export function recordVesselSourceUpdate({
  buildDurationMs,
  setDataDurationMs,
  vesselCount,
  featureCount,
}: {
  buildDurationMs: number;
  setDataDurationMs: number;
  vesselCount: number;
  featureCount: number;
}): void {
  const metrics = frontendMetrics().vesselSourceUpdates;
  metrics.flushCount += 1;
  metrics.totalBuildDurationMs += buildDurationMs;
  metrics.totalSetDataDurationMs += setDataDurationMs;
  metrics.avgBuildDurationMs = metrics.totalBuildDurationMs / metrics.flushCount;
  metrics.avgSetDataDurationMs = metrics.totalSetDataDurationMs / metrics.flushCount;
  metrics.maxBuildDurationMs = Math.max(metrics.maxBuildDurationMs, buildDurationMs);
  metrics.maxSetDataDurationMs = Math.max(metrics.maxSetDataDurationMs, setDataDurationMs);
  metrics.maxVesselCount = Math.max(metrics.maxVesselCount, vesselCount);
  metrics.maxFeatureCount = Math.max(metrics.maxFeatureCount, featureCount);
  metrics.lastBuildDurationMs = buildDurationMs;
  metrics.lastSetDataDurationMs = setDataDurationMs;
  metrics.lastVesselCount = vesselCount;
  metrics.lastFeatureCount = featureCount;
}
