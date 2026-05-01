import { Module } from '@nestjs/common';
import { ConfigModule } from '../../shared/config/config.module';
import { DbModule } from '../../shared/db/db.module';
import { SanctionsRepository } from './sanctions.repository';

@Module({
  imports: [ConfigModule, DbModule],
  providers: [SanctionsRepository],
  exports: [SanctionsRepository],
})
export class SanctionsCoreModule {}
