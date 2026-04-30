import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../shared/redis/redis.service';
import { ConfigService } from '../shared/config/config.service';

@Injectable()
export class DedupService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.ttlSeconds = config.get('DEDUP_TTL_SECONDS');
  }

  /**
   * Returns true on first sight of (mmsi, occurredAt) within the TTL window.
   * Atomic via SET NX: a duplicate inside the window returns false; once the
   * key expires the same event is accepted again — that is the documented
   * contract, not a bug.
   */
  async shouldAccept(mmsi: string, occurredAt: string): Promise<boolean> {
    const key = `dedup:${mmsi}:${occurredAt}`;
    const reply = await this.redis.client.set(key, '1', 'EX', this.ttlSeconds, 'NX');
    return reply === 'OK';
  }
}
