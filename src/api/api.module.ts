import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VesselsController } from './vessels.controller';

@Module({
  imports: [StorageModule],
  controllers: [VesselsController],
})
export class ApiModule {}
