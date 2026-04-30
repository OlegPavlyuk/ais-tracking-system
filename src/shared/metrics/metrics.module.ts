import { Global, Module } from '@nestjs/common';
import { PrometheusModule, makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { AIS_MESSAGES_DROPPED_TOTAL, DROP_REASONS } from './drop-reasons';

const droppedCounterProvider = makeCounterProvider({
  name: AIS_MESSAGES_DROPPED_TOTAL,
  help: 'Count of inbound AIS messages dropped before publish, labelled by drop reason.',
  labelNames: ['reason'] as const,
});

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [droppedCounterProvider],
  exports: [PrometheusModule, droppedCounterProvider],
})
export class MetricsModule {
  static readonly DROP_REASONS = DROP_REASONS;
}
