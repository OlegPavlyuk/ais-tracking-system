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
import { SanctionsImportCommandService } from '../enrichment/sanctions/sanctions-import-command.service';
import {
  SanctionsImportRunRow,
  SanctionsRepository,
} from '../enrichment/sanctions/sanctions.repository';
import { SANCTIONS_SOURCE_REGISTRY } from '../enrichment/sanctions/source-registry';
import { ApiError } from '../shared/errors/api-error';
import { AdminTokenGuard } from './admin-token.guard';

const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(20),
});

@Controller('admin/sanctions/imports')
@UseGuards(AdminTokenGuard)
export class SanctionsAdminController {
  constructor(
    @Inject(SanctionsRepository) private readonly repo: SanctionsRepository,
    @Inject(SanctionsImportCommandService)
    private readonly commands: SanctionsImportCommandService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string>): Promise<{ runs: SanctionsImportRunRow[] }> {
    const parsed = ListQuery.safeParse(query);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_QUERY',
        parsed.error.issues[0]?.message ?? 'invalid query',
        HttpStatus.BAD_REQUEST,
      );
    }
    const runs = await this.repo.findRecentRuns(parsed.data.limit);
    return { runs };
  }

  @Post(':source/run')
  async run(
    @Param('source') source: string,
  ): Promise<{ status: 'enqueued'; source: string; jobId: string }> {
    if (!SANCTIONS_SOURCE_REGISTRY.find((s) => s.id === source)) {
      throw new ApiError(
        'UNKNOWN_SOURCE',
        `unknown sanctions source: ${source}`,
        HttpStatus.BAD_REQUEST,
        { supported: SANCTIONS_SOURCE_REGISTRY.map((s) => s.id) },
      );
    }
    // Source registry currently allows only 'ofac'; cast is narrow on purpose.
    const { jobId } = await this.commands.requestRun(source as 'ofac');
    return { status: 'enqueued', source, jobId };
  }
}
