import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { KNOWN_STREAMS } from '../shared/config/constants';
import { RedisService } from '../shared/redis/redis.service';
import { AdminTokenGuard } from './admin-token.guard';

interface StreamGroupInfo {
  group: string;
  consumers: number;
  pending: number;
  lag: number | null;
}

interface StreamInfo {
  stream: string;
  status: 'present' | 'absent';
  groups: StreamGroupInfo[];
}

@Controller('admin/streams')
@UseGuards(AdminTokenGuard)
export class StreamsAdminController {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  @Get()
  async list(): Promise<{ streams: StreamInfo[] }> {
    const out: StreamInfo[] = [];
    for (const stream of KNOWN_STREAMS) {
      out.push(await this.describe(stream));
    }
    return { streams: out };
  }

  private async describe(stream: string): Promise<StreamInfo> {
    let raw: unknown;
    try {
      raw = await this.redis.client.xinfo('GROUPS', stream);
    } catch (err) {
      const msg = (err as Error).message;
      if (/no such key/i.test(msg)) return { stream, status: 'absent', groups: [] };
      throw err;
    }
    const groups: StreamGroupInfo[] = [];
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (!Array.isArray(entry)) continue;
        const map = pairsToMap(entry as unknown[]);
        const group = String(map.name ?? '');
        if (!group) continue;
        groups.push({
          group,
          consumers: numberOf(map.consumers),
          pending: numberOf(map.pending),
          lag: map.lag === null || map.lag === undefined ? null : numberOf(map.lag),
        });
      }
    }
    return { stream, status: 'present', groups };
  }
}

function pairsToMap(arr: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const key = arr[i];
    if (typeof key === 'string') out[key] = arr[i + 1];
  }
  return out;
}

function numberOf(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') return Number(v);
  return 0;
}
