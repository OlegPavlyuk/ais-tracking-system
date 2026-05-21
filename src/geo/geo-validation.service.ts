import { Injectable } from '@nestjs/common';
import { ConfigService } from '../shared/config/config.service';
import { GeoValidationInput, GeoValidationResult } from './geo-validation.types';

@Injectable()
export class GeoValidationService {
  constructor(private readonly config: ConfigService) {}

  async validatePosition(_position: GeoValidationInput): Promise<GeoValidationResult> {
    if (!this.config.get('GEO_VALIDATION_ENABLED')) {
      return { verdict: 'allow', reason: 'disabled' };
    }

    return { verdict: 'allow', reason: 'dataset_unavailable' };
  }
}
