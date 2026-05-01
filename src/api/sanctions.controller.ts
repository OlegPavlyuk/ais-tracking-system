import { Controller, Get, Inject } from '@nestjs/common';
import { SanctionsRepository } from '../enrichment/sanctions/sanctions.repository';
import {
  SANCTIONS_SOURCE_REGISTRY,
  SanctionsSourceMeta,
} from '../enrichment/sanctions/source-registry';

interface LastImportSummary {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  recordsImported: number;
  errors: unknown[];
}

interface SanctionsSourceResponse extends SanctionsSourceMeta {
  lastImport: LastImportSummary | null;
}

@Controller('api/sanctions')
export class SanctionsController {
  constructor(@Inject(SanctionsRepository) private readonly repo: SanctionsRepository) {}

  @Get('sources')
  async sources(): Promise<{ sources: SanctionsSourceResponse[] }> {
    const out = await Promise.all(
      SANCTIONS_SOURCE_REGISTRY.map(async (meta): Promise<SanctionsSourceResponse> => {
        const last = await this.repo.findLastRunBySource(meta.id);
        return {
          ...meta,
          lastImport: last
            ? {
                id: last.id,
                startedAt: last.startedAt,
                finishedAt: last.finishedAt,
                status: last.status,
                recordsImported: last.recordsImported,
                errors: last.errors,
              }
            : null,
        };
      }),
    );
    return { sources: out };
  }
}
