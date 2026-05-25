import { Inject, Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '../shared/config/config.service';
import {
  GEO_DATASET_ACTIVE_INFO,
  GEO_VALIDATION_CACHE_TOTAL,
  GEO_VALIDATION_DURATION_SECONDS,
  GEO_VALIDATION_TOTAL,
  GeoCacheResult,
  GeoValidationSource,
} from './geo.metrics';
import { GeoCacheService } from './geo-cache.service';
import { GeoDatasetRepository } from './geo-dataset.repository';
import {
  GeoValidationInput,
  GeoValidationReason,
  GeoValidationRepositoryResult,
  GeoValidationResult,
  GeoValidationVerdict,
} from './geo-validation.types';

@Injectable()
export class GeoValidationService {
  private lastActiveDatasetVersion: string | null = null;
  private hasLoggedDisabled = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(GeoDatasetRepository) private readonly repository: GeoDatasetRepository,
    @Inject(GeoCacheService) private readonly cache: GeoCacheService,
    @InjectMetric(GEO_VALIDATION_TOTAL)
    private readonly validationTotal: Counter<'verdict' | 'reason' | 'source'>,
    @InjectMetric(GEO_VALIDATION_CACHE_TOTAL)
    private readonly cacheTotal: Counter<'result'>,
    @InjectMetric(GEO_VALIDATION_DURATION_SECONDS)
    private readonly duration: Histogram<'source'>,
    @InjectMetric(GEO_DATASET_ACTIVE_INFO)
    private readonly activeDatasetInfo: Gauge<'version'>,
    private readonly pino: PinoLogger,
  ) {
    this.pino.setContext(GeoValidationService.name);
  }

  async validatePosition(position: GeoValidationInput): Promise<GeoValidationResult> {
    if (!this.config.get('GEO_VALIDATION_ENABLED')) {
      this.logDisabledOnce(position);
      return this.recordResult(
        { verdict: 'allow', reason: 'disabled', datasetVersion: null, shouldDrop: false },
        'bypass',
        0,
      );
    }

    const startedAt = process.hrtime.bigint();
    try {
      const activeDatasetVersion = await this.repository.getActiveDatasetVersion();
      if (activeDatasetVersion) {
        this.recordActiveDatasetVersion(activeDatasetVersion);
        const cached = await this.readCache(activeDatasetVersion, position);
        if (cached) {
          return this.recordResult(cached, 'cache', startedAt);
        }
      } else {
        this.clearActiveDatasetVersion();
      }

      const repositoryResult = await this.repository.validatePosition(position.lon, position.lat);
      const result = this.toResult(repositoryResult);
      if (result.datasetVersion) {
        this.recordActiveDatasetVersion(result.datasetVersion);
      }
      if (result.datasetVersion && result.reason !== 'dataset_unavailable') {
        await this.writeCache(result.datasetVersion, position, result);
      }

      return this.recordResult(result, 'postgis', startedAt);
    } catch (err) {
      const result = this.handleValidationError(err as Error, position);
      return this.recordResult(result, 'error', startedAt);
    }
  }

  private async readCache(
    datasetVersion: string,
    position: GeoValidationInput,
  ): Promise<GeoValidationResult | null> {
    if (!this.cache.isEnabled()) {
      this.recordCache('disabled');
      return null;
    }

    try {
      const cached = await this.cache.get(datasetVersion, position);
      this.recordCache(cached ? 'hit' : 'miss');
      return cached;
    } catch (err) {
      this.recordCache('error');
      this.pino.warn(
        {
          err: (err as Error).message,
          datasetVersion,
          mmsi: position.mmsi,
          provider: position.provider,
          traceId: position.traceId,
        },
        'geo validation cache read failed',
      );
      return null;
    }
  }

  private async writeCache(
    datasetVersion: string,
    position: GeoValidationInput,
    result: GeoValidationResult,
  ): Promise<void> {
    try {
      await this.cache.set(datasetVersion, position, result);
    } catch (err) {
      this.recordCache('error');
      this.pino.warn(
        {
          err: (err as Error).message,
          datasetVersion,
          verdict: result.verdict,
          reason: result.reason,
          mmsi: position.mmsi,
          provider: position.provider,
          traceId: position.traceId,
        },
        'geo validation cache write failed',
      );
    }
  }

  private handleValidationError(err: Error, position: GeoValidationInput): GeoValidationResult {
    const failOpen = this.config.get('GEO_VALIDATION_FAIL_OPEN');
    const result: GeoValidationResult = {
      verdict: failOpen ? 'allow' : 'reject',
      reason: 'geo_validation_error',
      datasetVersion: null,
      shouldDrop: !failOpen,
    };
    this.pino.warn(
      {
        err: err.message,
        failOpen,
        verdict: result.verdict,
        reason: result.reason,
        mmsi: position.mmsi,
        lat: position.lat,
        lon: position.lon,
        provider: position.provider,
        traceId: position.traceId,
      },
      'geo validation failed',
    );
    return result;
  }

  private toResult(repositoryResult: GeoValidationRepositoryResult): GeoValidationResult {
    return {
      ...repositoryResult,
      shouldDrop: this.shouldDrop(repositoryResult.verdict, repositoryResult.reason),
    };
  }

  private shouldDrop(verdict: GeoValidationVerdict, reason: GeoValidationReason): boolean {
    return verdict === 'reject' && (reason === 'deep_land' || reason === 'geo_validation_error');
  }

  private recordResult(
    result: GeoValidationResult,
    source: GeoValidationSource,
    startedAt: bigint | 0,
  ): GeoValidationResult {
    this.validationTotal.inc({
      verdict: result.verdict,
      reason: result.reason,
      source,
    });
    this.duration.observe({ source }, this.elapsedSeconds(startedAt));
    return result;
  }

  private recordCache(result: GeoCacheResult): void {
    this.cacheTotal.inc({ result });
  }

  private recordActiveDatasetVersion(datasetVersion: string): void {
    if (
      this.lastActiveDatasetVersion &&
      this.lastActiveDatasetVersion !== datasetVersion &&
      typeof this.activeDatasetInfo.remove === 'function'
    ) {
      this.activeDatasetInfo.remove({ version: this.lastActiveDatasetVersion });
    }
    this.lastActiveDatasetVersion = datasetVersion;
    this.activeDatasetInfo.set({ version: datasetVersion }, 1);
  }

  private clearActiveDatasetVersion(): void {
    if (this.lastActiveDatasetVersion && typeof this.activeDatasetInfo.remove === 'function') {
      this.activeDatasetInfo.remove({ version: this.lastActiveDatasetVersion });
    }
    this.lastActiveDatasetVersion = null;
  }

  private logDisabledOnce(position: GeoValidationInput): void {
    if (this.hasLoggedDisabled) {
      return;
    }

    this.hasLoggedDisabled = true;
    this.pino.info(
      {
        mmsi: position.mmsi,
        lat: position.lat,
        lon: position.lon,
        provider: position.provider,
        traceId: position.traceId,
      },
      'geo validation disabled',
    );
  }

  private elapsedSeconds(startedAt: bigint | 0): number {
    if (startedAt === 0) {
      return 0;
    }

    return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
  }
}
