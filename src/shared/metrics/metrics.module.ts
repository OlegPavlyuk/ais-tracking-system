import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { AIS_MESSAGES_DROPPED_TOTAL, DROP_REASONS } from './drop-reasons';
import {
  AIS_PROVIDER_CONNECTED,
  AIS_PROVIDER_LAST_MESSAGE_AGE_SECONDS,
  AIS_PROVIDER_RECONNECTS_TOTAL,
} from './provider-metrics';
import {
  WS_CONNECTIONS_ACTIVE,
  WS_MESSAGES_DROPPED_TOTAL,
  WS_MESSAGES_SENT_TOTAL,
  WS_SUBSCRIBER_BBOX_UPDATES_TOTAL,
} from './ws-metrics';
import {
  AIS_DEADLETTER_TOTAL,
  AIS_EVENTS_PUBLISHED_TOTAL,
  AIS_MESSAGES_RECEIVED_TOTAL,
  AIS_STREAM_CONSUMER_LAG,
  AIS_STREAM_CONSUMER_PENDING,
  AIS_STREAM_HANDLER_DURATION_SECONDS,
  AIS_STREAM_HANDLER_ERRORS_TOTAL,
  DB_QUERY_DURATION_SECONDS,
  DB_WRITES_TOTAL,
  ENRICHMENT_JOBS_TOTAL,
  HTTP_REQUEST_DURATION_SECONDS,
  SANCTIONS_IMPORT_DURATION_SECONDS,
  SANCTIONS_IMPORT_RECORDS_TOTAL,
  SANCTIONS_MATCHES_TOTAL,
} from './metric-names';
import { StreamLagService } from './stream-lag.service';

const droppedCounterProvider = makeCounterProvider({
  name: AIS_MESSAGES_DROPPED_TOTAL,
  help: 'Count of inbound AIS messages dropped before publish, labelled by drop reason.',
  labelNames: ['reason'] as const,
});

const wsConnectionsActiveProvider = makeGaugeProvider({
  name: WS_CONNECTIONS_ACTIVE,
  help: 'Number of currently open realtime WebSocket connections.',
});

const wsMessagesSentProvider = makeCounterProvider({
  name: WS_MESSAGES_SENT_TOTAL,
  help: 'Total realtime WebSocket messages sent to clients, labelled by kind.',
  labelNames: ['kind'] as const,
});

const wsMessagesDroppedProvider = makeCounterProvider({
  name: WS_MESSAGES_DROPPED_TOTAL,
  help: 'Total realtime WebSocket messages dropped before send, labelled by reason.',
  labelNames: ['reason'] as const,
});

const wsBboxUpdatesProvider = makeCounterProvider({
  name: WS_SUBSCRIBER_BBOX_UPDATES_TOTAL,
  help: 'Total subscribe/update_subscription messages accepted from clients.',
});

const providerConnectedProvider = makeGaugeProvider({
  name: AIS_PROVIDER_CONNECTED,
  help: '1 if the AIS provider connection is currently OPEN, 0 otherwise.',
  labelNames: ['provider'] as const,
});

const providerLastMessageAgeProvider = makeGaugeProvider({
  name: AIS_PROVIDER_LAST_MESSAGE_AGE_SECONDS,
  help: 'Seconds since the last raw message received from the AIS provider.',
  labelNames: ['provider'] as const,
});

const providerReconnectsProvider = makeCounterProvider({
  name: AIS_PROVIDER_RECONNECTS_TOTAL,
  help: 'Total reconnect attempts made by the AIS provider adapter.',
  labelNames: ['provider'] as const,
});

const messagesReceivedProvider = makeCounterProvider({
  name: AIS_MESSAGES_RECEIVED_TOTAL,
  help: 'Total raw AIS messages accepted by the provider adapter and forwarded to the pipeline.',
  labelNames: ['provider'] as const,
});

const eventsPublishedProvider = makeCounterProvider({
  name: AIS_EVENTS_PUBLISHED_TOTAL,
  help: 'Total canonical events published to a stream, labelled by stream and kind.',
  labelNames: ['stream', 'kind'] as const,
});

const streamLagProvider = makeGaugeProvider({
  name: AIS_STREAM_CONSUMER_LAG,
  help: 'Approximate consumer-group lag (entries behind tail), per stream and group.',
  labelNames: ['stream', 'group'] as const,
});

const streamPendingProvider = makeGaugeProvider({
  name: AIS_STREAM_CONSUMER_PENDING,
  help: 'Pending (unacked) message count per consumer group.',
  labelNames: ['stream', 'group'] as const,
});

const streamHandlerDurationProvider = makeHistogramProvider({
  name: AIS_STREAM_HANDLER_DURATION_SECONDS,
  help: 'Stream handler invocation duration in seconds.',
  labelNames: ['stream', 'group'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const streamHandlerErrorsProvider = makeCounterProvider({
  name: AIS_STREAM_HANDLER_ERRORS_TOTAL,
  help: 'Total stream handler errors per stream and group.',
  labelNames: ['stream', 'group'] as const,
});

const deadletterTotalProvider = makeCounterProvider({
  name: AIS_DEADLETTER_TOTAL,
  help: 'Messages dead-lettered, labelled by source stream and DLQ reason.',
  labelNames: ['stream', 'reason'] as const,
});

const dbQueryDurationProvider = makeHistogramProvider({
  name: DB_QUERY_DURATION_SECONDS,
  help: 'Duration of named database queries in seconds.',
  labelNames: ['query'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const dbWritesTotalProvider = makeCounterProvider({
  name: DB_WRITES_TOTAL,
  help: 'Database write operations, labelled by table.',
  labelNames: ['table'] as const,
});

const enrichmentJobsProvider = makeCounterProvider({
  name: ENRICHMENT_JOBS_TOTAL,
  help: 'Enrichment job outcomes, labelled by status.',
  labelNames: ['status'] as const,
});

const sanctionsImportDurationProvider = makeHistogramProvider({
  name: SANCTIONS_IMPORT_DURATION_SECONDS,
  help: 'Sanctions import run duration in seconds, labelled by source.',
  labelNames: ['source'] as const,
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1200],
});

const sanctionsImportRecordsProvider = makeCounterProvider({
  name: SANCTIONS_IMPORT_RECORDS_TOTAL,
  help: 'Total entities imported across sanctions import runs, labelled by source.',
  labelNames: ['source'] as const,
});

const sanctionsMatchesProvider = makeCounterProvider({
  name: SANCTIONS_MATCHES_TOTAL,
  help: 'Total sanctions matches produced, labelled by match_type.',
  labelNames: ['match_type'] as const,
});

const httpRequestDurationProvider = makeHistogramProvider({
  name: HTTP_REQUEST_DURATION_SECONDS,
  help: 'HTTP request duration in seconds.',
  labelNames: ['route', 'method', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const ALL_PROVIDERS = [
  droppedCounterProvider,
  wsConnectionsActiveProvider,
  wsMessagesSentProvider,
  wsMessagesDroppedProvider,
  wsBboxUpdatesProvider,
  providerConnectedProvider,
  providerLastMessageAgeProvider,
  providerReconnectsProvider,
  messagesReceivedProvider,
  eventsPublishedProvider,
  streamLagProvider,
  streamPendingProvider,
  streamHandlerDurationProvider,
  streamHandlerErrorsProvider,
  deadletterTotalProvider,
  dbQueryDurationProvider,
  dbWritesTotalProvider,
  enrichmentJobsProvider,
  sanctionsImportDurationProvider,
  sanctionsImportRecordsProvider,
  sanctionsMatchesProvider,
  httpRequestDurationProvider,
];

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    ...ALL_PROVIDERS,
    StreamLagService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [PrometheusModule, ...ALL_PROVIDERS],
})
export class MetricsModule {
  static readonly DROP_REASONS = DROP_REASONS;
}
