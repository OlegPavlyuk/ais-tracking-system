import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../shared/db/db.service';
import { GeoValidationRepositoryResult } from './geo-validation.types';

@Injectable()
export class GeoDatasetRepository {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  async getActiveDatasetVersion(): Promise<string | null> {
    return this.dbs.withReservedConnection(async (connection) => {
      const rows = await connection<{ version: string }[]>`
        SELECT version
        FROM geo_dataset_versions
        WHERE is_active
        ORDER BY activated_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `;
      return rows[0]?.version ?? null;
    });
  }

  async validatePosition(lon: number, lat: number): Promise<GeoValidationRepositoryResult> {
    return this.dbs.withReservedConnection(async (connection) => {
      const rows = await connection<{ result: GeoValidationRepositoryResult }[]>`
        SELECT geo_validate_position(${lon}, ${lat}) AS result
      `;
      const result = rows[0]?.result;
      if (!result) {
        throw new Error('geo_validate_position returned no result');
      }
      return result;
    });
  }
}
