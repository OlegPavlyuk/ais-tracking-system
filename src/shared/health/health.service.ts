import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

export interface ReadinessReport {
  ready: boolean;
  checks: {
    db: boolean;
    redis: boolean;
  };
  feedDegraded: boolean;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  liveness(): { alive: true } {
    return { alive: true };
  }

  async readiness(): Promise<ReadinessReport> {
    const [db, redis] = await Promise.all([this.db.ping(), this.redis.ping()]);
    return {
      ready: db && redis,
      checks: { db, redis },
      // Filled in once provider health is wired (Slice #11).
      feedDegraded: false,
    };
  }
}
