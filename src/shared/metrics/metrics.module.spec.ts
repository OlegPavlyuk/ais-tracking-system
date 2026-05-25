import { MODULE_METADATA } from '@nestjs/common/constants';
import { getToken } from '@willsoto/nestjs-prometheus';
import { MetricsModule } from './metrics.module';
import {
  AIS_GEO_DATASET_ACTIVE_INFO,
  AIS_GEO_VALIDATION_CACHE_TOTAL,
  AIS_GEO_VALIDATION_DURATION_SECONDS,
  AIS_GEO_VALIDATION_TOTAL,
} from './metric-names';

describe('MetricsModule', () => {
  it('exposes geo metric providers', () => {
    const exportedProviders =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, MetricsModule) ?? [];

    expect(exportedProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: getToken(AIS_GEO_VALIDATION_TOTAL) }),
        expect.objectContaining({ provide: getToken(AIS_GEO_VALIDATION_CACHE_TOTAL) }),
        expect.objectContaining({ provide: getToken(AIS_GEO_VALIDATION_DURATION_SECONDS) }),
        expect.objectContaining({ provide: getToken(AIS_GEO_DATASET_ACTIVE_INFO) }),
      ]),
    );
  });
});
