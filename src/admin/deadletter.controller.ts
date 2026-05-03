import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { EVENT_BUS, EventBus } from '../shared/bus/event-bus';
import { AIS_DEADLETTER_STREAM } from '../shared/config/constants';
import { ApiError } from '../shared/errors/api-error';
import { RedisService } from '../shared/redis/redis.service';
import { AdminTokenGuard } from './admin-token.guard';

const ListQuery = z.object({
  stream: z.string().min(1).default(AIS_DEADLETTER_STREAM),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const StreamIdParam = z.string().regex(/^\d+-\d+$/, 'expected redis stream id like "1700000000000-0"');

interface DeadletterEntry {
  id: string;
  payload: unknown;
}

@Controller('admin/deadletter')
@UseGuards(AdminTokenGuard)
export class DeadletterController {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string>): Promise<{ stream: string; entries: DeadletterEntry[] }> {
    const parsed = ListQuery.safeParse(query);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_QUERY',
        parsed.error.issues[0]?.message ?? 'invalid query',
        HttpStatus.BAD_REQUEST,
      );
    }
    const { stream, limit } = parsed.data;
    let raw: [string, string[]][] = [];
    try {
      raw = (await this.redis.client.xrevrange(stream, '+', '-', 'COUNT', limit)) as [
        string,
        string[],
      ][];
    } catch (err) {
      const msg = (err as Error).message;
      if (/no such key/i.test(msg)) return { stream, entries: [] };
      throw err;
    }
    return { stream, entries: raw.map(([id, fields]) => ({ id, payload: parseFields(fields) })) };
  }

  @Post(':id/replay')
  async replay(
    @Param('id') id: string,
  ): Promise<{
    status: 'replayed';
    deadletterId: string;
    originalStream: string;
    newMessageId: string;
    note: string;
  }> {
    const idParsed = StreamIdParam.safeParse(id);
    if (!idParsed.success) {
      throw new ApiError('INVALID_QUERY', idParsed.error.issues[0]!.message, HttpStatus.BAD_REQUEST);
    }
    const range = (await this.redis.client.xrange(
      AIS_DEADLETTER_STREAM,
      idParsed.data,
      idParsed.data,
    )) as [string, string[]][];
    const entry = range[0];
    if (!entry) {
      throw new ApiError(
        'DEADLETTER_NOT_FOUND',
        `deadletter entry ${idParsed.data} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    const payload = parseFields(entry[1]);
    if (!isReplayable(payload)) {
      throw new ApiError(
        'DEADLETTER_INVALID',
        'deadletter entry missing originalStream/originalEvent',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const newMessageId = await this.bus.publish(payload.originalStream, payload.originalEvent);
    return {
      status: 'replayed',
      deadletterId: idParsed.data,
      originalStream: payload.originalStream,
      newMessageId,
      note: 'DLQ entry retained; if processing fails again it will produce a new DLQ entry',
    };
  }
}

function parseFields(fields: string[]): unknown {
  const idx = fields.indexOf('data');
  if (idx === -1) return null;
  const raw = fields[idx + 1];
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparsed: raw };
  }
}

function isReplayable(payload: unknown): payload is { originalStream: string; originalEvent: unknown } {
  if (typeof payload !== 'object' || payload === null) return false;
  const obj = payload as Record<string, unknown>;
  return typeof obj.originalStream === 'string' && 'originalEvent' in obj;
}
