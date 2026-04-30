import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../shared/redis/redis.service';
import { ConfigService } from '../shared/config/config.service';
import { PositionEvent } from '../contracts';

interface SamplerState {
  lastEmittedAt: string;
  lastNavStatus: number | null;
}

function parseState(raw: string | null): SamplerState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SamplerState>;
    if (typeof parsed?.lastEmittedAt !== 'string') return null;
    const navStatus =
      parsed.lastNavStatus === null || typeof parsed.lastNavStatus === 'number'
        ? parsed.lastNavStatus
        : null;
    return { lastEmittedAt: parsed.lastEmittedAt, lastNavStatus: navStatus };
  } catch {
    return null;
  }
}

@Injectable()
export class SamplerService {
  private readonly movingWindowMs: number;
  private readonly stationaryWindowMs: number;
  private readonly stationarySogThreshold: number;
  private readonly stateTtlSeconds: number;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.movingWindowMs = config.get('SAMPLER_MOVING_WINDOW_SECONDS') * 1000;
    this.stationaryWindowMs = config.get('SAMPLER_STATIONARY_WINDOW_SECONDS') * 1000;
    this.stationarySogThreshold = config.get('SAMPLER_STATIONARY_SOG_KN');
    this.stateTtlSeconds = config.get('SAMPLER_STATE_TTL_SECONDS');
  }

  /**
   * Returns true when this position event should be published. Enforces:
   *   - 10s window for moving (sog >= 0.5 kn) vessels
   *   - 60s window for stationary (sog < 0.5 kn) vessels
   *   - bypass when navStatus changed from the last emitted state
   */
  async shouldEmit(event: PositionEvent): Promise<boolean> {
    const key = `sampler:${event.mmsi}`;
    const raw = await this.redis.client.get(key);
    const navStatus = event.navStatus ?? null;
    const state = parseState(raw);

    if (!state) {
      await this.writeState(key, { lastEmittedAt: event.occurredAt, lastNavStatus: navStatus });
      return true;
    }

    if (navStatus !== null && navStatus !== state.lastNavStatus) {
      await this.writeState(key, { lastEmittedAt: event.occurredAt, lastNavStatus: navStatus });
      return true;
    }

    const windowMs =
      (event.sog ?? 0) < this.stationarySogThreshold ? this.stationaryWindowMs : this.movingWindowMs;
    const elapsed = Date.parse(event.occurredAt) - Date.parse(state.lastEmittedAt);
    if (elapsed >= windowMs) {
      await this.writeState(key, { lastEmittedAt: event.occurredAt, lastNavStatus: navStatus });
      return true;
    }
    return false;
  }

  private async writeState(key: string, state: SamplerState): Promise<void> {
    await this.redis.client.set(key, JSON.stringify(state), 'EX', this.stateTtlSeconds);
  }
}
