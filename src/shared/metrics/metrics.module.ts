import { Global, Module } from '@nestjs/common';
import { PrometheusModule, makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
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

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    droppedCounterProvider,
    wsConnectionsActiveProvider,
    wsMessagesSentProvider,
    wsMessagesDroppedProvider,
    wsBboxUpdatesProvider,
    providerConnectedProvider,
    providerLastMessageAgeProvider,
    providerReconnectsProvider,
  ],
  exports: [
    PrometheusModule,
    droppedCounterProvider,
    wsConnectionsActiveProvider,
    wsMessagesSentProvider,
    wsMessagesDroppedProvider,
    wsBboxUpdatesProvider,
    providerConnectedProvider,
    providerLastMessageAgeProvider,
    providerReconnectsProvider,
  ],
})
export class MetricsModule {
  static readonly DROP_REASONS = DROP_REASONS;
}
