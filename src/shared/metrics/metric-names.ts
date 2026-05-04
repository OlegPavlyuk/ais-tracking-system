// Central registry of metric names introduced in slice #12.
// Keep names aligned with docs/architecture-decisions.md "Headline metrics".

export const AIS_MESSAGES_RECEIVED_TOTAL = 'ais_messages_received_total';
export const AIS_EVENTS_PUBLISHED_TOTAL = 'ais_events_published_total';
export const AIS_STREAM_CONSUMER_LAG = 'ais_stream_consumer_lag';
export const AIS_STREAM_CONSUMER_PENDING = 'ais_stream_consumer_pending';
export const AIS_STREAM_HANDLER_DURATION_SECONDS = 'ais_stream_handler_duration_seconds';
export const AIS_STREAM_HANDLER_ERRORS_TOTAL = 'ais_stream_handler_errors_total';
export const AIS_DEADLETTER_TOTAL = 'ais_deadletter_total';

export const DB_QUERY_DURATION_SECONDS = 'db_query_duration_seconds';
export const DB_WRITES_TOTAL = 'db_writes_total';

export const ENRICHMENT_JOBS_TOTAL = 'enrichment_jobs_total';
export const SANCTIONS_IMPORT_DURATION_SECONDS = 'sanctions_import_duration_seconds';
export const SANCTIONS_IMPORT_RECORDS_TOTAL = 'sanctions_import_records_total';
export const SANCTIONS_MATCHES_TOTAL = 'sanctions_matches_total';

export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';
