import { Controller, Get, HttpStatus, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { VesselsRepository, VesselSnapshotRow } from '../storage/vessels.repository';
import { ApiError } from '../shared/errors/api-error';
import { BLACK_SEA_BBOX, Bbox, bboxContains } from '../shared/config/constants';

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
}
