import {
  AIS_GEO_DATASET_ACTIVE_INFO,
  AIS_GEO_VALIDATION_CACHE_TOTAL,
  AIS_GEO_VALIDATION_DURATION_SECONDS,
  AIS_GEO_VALIDATION_TOTAL,
} from '../shared/metrics/metric-names';

export const GEO_VALIDATION_TOTAL = AIS_GEO_VALIDATION_TOTAL;
export const GEO_VALIDATION_CACHE_TOTAL = AIS_GEO_VALIDATION_CACHE_TOTAL;
export const GEO_VALIDATION_DURATION_SECONDS = AIS_GEO_VALIDATION_DURATION_SECONDS;
export const GEO_DATASET_ACTIVE_INFO = AIS_GEO_DATASET_ACTIVE_INFO;

export const GEO_VALIDATION_SOURCES = ['cache', 'postgis', 'bypass', 'error'] as const;
export type GeoValidationSource = (typeof GEO_VALIDATION_SOURCES)[number];

export const GEO_CACHE_RESULTS = ['hit', 'miss', 'disabled', 'error'] as const;
export type GeoCacheResult = (typeof GEO_CACHE_RESULTS)[number];
