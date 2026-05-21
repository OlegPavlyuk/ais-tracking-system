import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '../shared/config/config.service';
import { RedisService } from '../shared/redis/redis.service';
import { GeoValidationInput, GeoValidationResult } from './geo-validation.types';

@Injectable()
export class GeoCacheService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  isEnabled(): boolean {
    return this.config.get('GEO_CACHE_ENABLED');
  }

  buildKey(datasetVersion: string, position: Pick<GeoValidationInput, 'lat' | 'lon'>): string {
    const precision = this.config.get('GEO_CACHE_PRECISION');
    const latBucket = position.lat.toFixed(precision);
    const lonBucket = position.lon.toFixed(precision);
    return `geo:validation:${datasetVersion}:p${precision}:${latBucket}:${lonBucket}`;
  }

  async get(
    datasetVersion: string,
    position: Pick<GeoValidationInput, 'lat' | 'lon'>,
  ): Promise<GeoValidationResult | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const raw = await this.redis.client.get(this.buildKey(datasetVersion, position));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as GeoValidationResult;
  }

  async set(
    datasetVersion: string,
    position: Pick<GeoValidationInput, 'lat' | 'lon'>,
    result: GeoValidationResult,
  ): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const ttlSeconds =
      result.verdict === 'uncertain'
        ? this.config.get('GEO_CACHE_UNCERTAIN_TTL_SECONDS')
        : this.config.get('GEO_CACHE_TTL_SECONDS');
    await this.redis.client.set(
      this.buildKey(datasetVersion, position),
      JSON.stringify(result),
      'EX',
      ttlSeconds,
    );
  }
}
