import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DbService } from './db.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
