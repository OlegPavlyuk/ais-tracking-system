import { Module } from '@nestjs/common';
import { FanoutConsumer } from './fanout.consumer';
import { RealtimeGateway } from './realtime.gateway';
import { SubscriptionService } from './subscription.service';

@Module({
  providers: [SubscriptionService, RealtimeGateway, FanoutConsumer],
  exports: [SubscriptionService, RealtimeGateway],
})
export class RealtimeModule {}
