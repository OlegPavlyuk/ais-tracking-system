# Frontend Metrics

## Purpose

The frontend exposes lightweight browser-side diagnostics to establish a runtime performance baseline during frontend investigations. These metrics were added to evaluate frontend scalability before deciding whether more complex optimizations are needed, such as realtime batching, viewport filtering, or MapLibre source partitioning. Metrics are local to the current browser session and are intended for quick inspection while testing realtime vessel updates and map rendering behavior.

## Viewing Metrics

Open the browser console and inspect the metrics object:

```js
globalThis.__AIS_FRONTEND_METRICS__
```

Realtime metrics:

```js
globalThis.__AIS_FRONTEND_METRICS__.realtime
```

Map update metrics:

```js
globalThis.__AIS_FRONTEND_METRICS__.vesselSourceUpdates
```

Reset metrics for a fresh measurement window:

```js
globalThis.__AIS_FRONTEND_METRICS__.reset()
```

## Typical Workflow

1. Open the application.
2. Open the browser DevTools Console.
3. Reset metrics:

```js
globalThis.__AIS_FRONTEND_METRICS__.reset()
```

4. Use the application for a few minutes, ideally in the scenario being investigated.
5. Inspect metrics:

```js
globalThis.__AIS_FRONTEND_METRICS__
```

6. Compare the most important fields: `avgBuildDurationMs`, `avgSetDataDurationMs`, `maxBuildDurationMs`, `maxSetDataDurationMs`, `maxVesselCount`, and `maxFeatureCount`.

Use these values to decide whether further frontend optimizations are justified.

## Metric Definitions

Realtime metrics:

- `totalMessages` - total realtime messages processed.
- `positionMessages` - position update messages processed.
- `staticMessages` - static vessel profile messages processed.
- `enrichedMessages` - vessel enrichment messages processed.
- `errorMessages` - realtime error messages processed.

Map update metrics:

- `flushCount` - number of MapLibre source updates performed.
- `totalBuildDurationMs` - cumulative time spent building GeoJSON feature collections.
- `totalSetDataDurationMs` - cumulative synchronous time spent calling `source.setData(...)`.
- `avgBuildDurationMs` - average time spent building GeoJSON per source update.
- `avgSetDataDurationMs` - average synchronous time spent in `source.setData(...)` per source update.
- `maxBuildDurationMs` - slowest observed GeoJSON build duration.
- `maxSetDataDurationMs` - slowest observed synchronous `source.setData(...)` duration.
- `lastBuildDurationMs` - most recent GeoJSON build duration.
- `lastSetDataDurationMs` - most recent synchronous `source.setData(...)` duration.
- `lastVesselCount` - vessel count in the store for the most recent source update.
- `lastFeatureCount` - feature count sent to MapLibre for the most recent source update.
- `maxVesselCount` - largest vessel count observed during the session.
- `maxFeatureCount` - largest feature count sent to MapLibre during the session.

## Interpretation Notes

Build timings measure GeoJSON generation cost in the frontend. `setData` timings measure only the synchronous cost of calling MapLibre's `source.setData(...)`; they do not represent the full asynchronous rendering cost inside MapLibre.

These metrics are diagnostics, not production monitoring. They intentionally stay local, browser-side, and lightweight so they can be inspected or reset during manual performance investigations without external telemetry or backend changes.
