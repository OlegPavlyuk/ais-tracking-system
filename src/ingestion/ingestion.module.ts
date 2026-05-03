import { Module } from '@nestjs/common';
import { ConfigModule } from '../shared/config/config.module';
import { PROVIDER_HEALTH_SOURCE } from '../shared/health/provider-health';
import { AisStreamAdapter } from './aisstream/aisstream.adapter';
import { AisStreamNormalizer } from './aisstream/aisstream.normalizer';
import { AisStreamRawFilter } from './aisstream/aisstream.raw-filter';
import { ProviderPair } from './provider';
import { PROVIDER_PAIRS, ProviderRegistry } from './provider-registry';

const providerPairsFactory = {
  provide: PROVIDER_PAIRS,
  useFactory: (
    aisstream: AisStreamAdapter,
    normalizer: AisStreamNormalizer,
  ): ProviderPair[] => [{ adapter: aisstream, normalizer }],
  inject: [AisStreamAdapter, AisStreamNormalizer],
};

@Module({
  imports: [ConfigModule],
  providers: [
    AisStreamRawFilter,
    AisStreamAdapter,
    AisStreamNormalizer,
    providerPairsFactory,
    ProviderRegistry,
    { provide: PROVIDER_HEALTH_SOURCE, useExisting: ProviderRegistry },
  ],
  exports: [ProviderRegistry, PROVIDER_HEALTH_SOURCE],
})
export class IngestionModule {}
