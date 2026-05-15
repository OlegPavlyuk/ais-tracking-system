import { RedisService } from '../../shared/redis/redis.service';

export const ENRICHMENT_VESSEL_QUEUE = 'enrichment.vessel';
export const ENRICHMENT_REDIS = 'ENRICHMENT_REDIS';

export type EnrichmentTrigger = 'discovered' | 'stale' | 'profile_changed';

export interface EnrichmentJobData {
  vesselId: string;
  mmsi: string;
  trigger: EnrichmentTrigger;
  profileHash: string;
  observedImo: string | null;
  observedName: string | null;
  traceId?: string;
}

export const enrichmentRedisProvider = {
  provide: ENRICHMENT_REDIS,
  inject: [RedisService],
  useFactory: (redis: RedisService) => redis.client,
};
