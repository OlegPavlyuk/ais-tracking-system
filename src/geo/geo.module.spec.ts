import { MODULE_METADATA } from '@nestjs/common/constants';
import { GeoCacheService } from './geo-cache.service';
import { GeoDatasetRepository } from './geo-dataset.repository';
import { GeoModule } from './geo.module';
import { GeoValidationService } from './geo-validation.service';
import { MetricsModule } from '../shared/metrics/metrics.module';

describe('GeoModule', () => {
  it('exports GeoValidationService for pipeline consumption', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, GeoModule) ?? [];

    expect(exports).toEqual(expect.arrayContaining([GeoValidationService]));
  });

  it('provides geo runtime repository and cache services', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, GeoModule) ?? [];

    expect(providers).toEqual(
      expect.arrayContaining([GeoValidationService, GeoDatasetRepository, GeoCacheService]),
    );
  });

  it('imports metrics providers directly for isolated geo module composition', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, GeoModule) ?? [];

    expect(imports).toEqual(expect.arrayContaining([MetricsModule]));
  });
});
