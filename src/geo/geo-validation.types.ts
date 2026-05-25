export type GeoValidationVerdict = 'allow' | 'reject' | 'uncertain';

export type GeoValidationReason =
  | 'manual_allow'
  | 'navigable_water'
  | 'coastal_tolerance'
  | 'deep_land'
  | 'not_land'
  | 'dataset_unavailable'
  | 'invalid_coordinates'
  | 'disabled'
  | 'geo_validation_error';

export interface GeoValidationInput {
  lat: number;
  lon: number;
  mmsi?: string;
  provider?: string;
  traceId?: string;
}

export interface GeoValidationResult {
  verdict: GeoValidationVerdict;
  reason: GeoValidationReason;
  datasetVersion: string | null;
  shouldDrop: boolean;
}

export interface GeoValidationRepositoryResult {
  verdict: GeoValidationVerdict;
  reason: Exclude<GeoValidationReason, 'disabled' | 'geo_validation_error'>;
  datasetVersion: string | null;
}
