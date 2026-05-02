import { Controller, Get, HttpStatus, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  TrackPoint,
  VesselDetailRow,
  VesselsRepository,
  VesselSnapshotRow,
} from '../storage/vessels.repository';
import { ApiError } from '../shared/errors/api-error';
import { BLACK_SEA_BBOX, Bbox, bboxContains } from '../shared/config/constants';

const UuidParam = z.string().uuid();

const MAX_TRACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const TrackQuery = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    simplify: z.coerce.number().positive().optional(),
  })
  .superRefine((q, ctx) => {
    const from = new Date(q.from).getTime();
    const to = new Date(q.to).getTime();
    if (!(from < to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must be earlier than to' });
      return;
    }
    if (to - from > MAX_TRACK_WINDOW_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'window exceeds 7-day maximum' });
    }
  });

export type TrackResponse =
  | { vesselId: string; from: string; to: string; points: TrackPoint[] }
  | {
      vesselId: string;
      from: string;
      to: string;
      simplifyMeters: number;
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    };

export type VesselDetailResponse = VesselDetailRow;

const BboxQuery = z.object({
  bbox: z
    .string()
    .min(1, 'bbox is required')
    .transform((s, ctx) => {
      const parts = s.split(',').map((p) => Number(p.trim()));
      if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox must be minLon,minLat,maxLon,maxLat' });
        return z.NEVER;
      }
      const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
      if (minLon >= maxLon || minLat >= maxLat) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox must satisfy minLon<maxLon and minLat<maxLat' });
        return z.NEVER;
      }
      return { minLon, minLat, maxLon, maxLat } as Bbox;
    }),
  limit: z.coerce.number().int().positive().max(5000).default(2000),
  staleMinutes: z.coerce.number().int().positive().max(60 * 24 * 7).default(60 * 24),
});

@Controller('api/vessels')
export class VesselsController {
  constructor(@Inject(VesselsRepository) private readonly repo: VesselsRepository) {}

  @Get()
  async list(@Query() query: Record<string, string>): Promise<{ vessels: VesselSnapshotRow[] }> {
    const parsed = BboxQuery.safeParse(query);
    if (!parsed.success) {
      throw new ApiError('INVALID_QUERY', parsed.error.issues[0]?.message ?? 'invalid query', HttpStatus.BAD_REQUEST, parsed.error.issues);
    }
    const { bbox, limit, staleMinutes } = parsed.data;
    if (!bboxContains(BLACK_SEA_BBOX, bbox)) {
      throw new ApiError(
        'BBOX_OUT_OF_SCOPE',
        'bbox is outside the supported Black Sea coverage area',
        HttpStatus.BAD_REQUEST,
        { supportedBbox: BLACK_SEA_BBOX },
      );
    }
    const vessels = await this.repo.findInBbox(bbox, staleMinutes * 60 * 1000, limit);
    return { vessels };
  }

  @Get(':id/track')
  async track(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ): Promise<TrackResponse> {
    const idParsed = UuidParam.safeParse(id);
    if (!idParsed.success) {
      throw new ApiError('INVALID_QUERY', 'id must be a UUID', HttpStatus.BAD_REQUEST);
    }
    const parsed = TrackQuery.safeParse(query);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_QUERY',
        parsed.error.issues[0]?.message ?? 'invalid query',
        HttpStatus.BAD_REQUEST,
        parsed.error.issues,
      );
    }
    const { from, to, simplify } = parsed.data;
    const result = await this.repo.findTrack(idParsed.data, new Date(from), new Date(to), simplify);
    if (result.kind === 'points') {
      return { vesselId: idParsed.data, from, to, points: result.points };
    }
    return {
      vesselId: idParsed.data,
      from,
      to,
      simplifyMeters: simplify as number,
      geometry: { type: 'LineString', coordinates: result.coordinates },
    };
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<VesselDetailResponse> {
    const parsed = UuidParam.safeParse(id);
    if (!parsed.success) {
      throw new ApiError('INVALID_QUERY', 'id must be a UUID', HttpStatus.BAD_REQUEST);
    }
    const row = await this.repo.findById(parsed.data);
    if (!row) {
      throw new ApiError('VESSEL_NOT_FOUND', `vessel ${parsed.data} not found`, HttpStatus.NOT_FOUND);
    }
    return row;
  }
}
