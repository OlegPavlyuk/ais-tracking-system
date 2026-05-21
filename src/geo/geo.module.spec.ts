import { MODULE_METADATA } from '@nestjs/common/constants';
import { GeoModule } from './geo.module';
import { GeoValidationService } from './geo-validation.service';

describe('GeoModule', () => {
  it('exports GeoValidationService for pipeline consumption', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, GeoModule) ?? [];

    expect(exports).toEqual(expect.arrayContaining([GeoValidationService]));
  });
});
