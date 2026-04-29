import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { Sql } from 'postgres';
import { ConfigService } from '../config/config.service';

export const DB_CONNECTION = Symbol('DB_CONNECTION');

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly client: Sql;
  readonly db: PostgresJsDatabase;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.client = postgres(config.get('DATABASE_URL'), { max: 10 });
    this.db = drizzle(this.client);
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return true;
    } catch (err) {
      this.logger.warn(`Postgres ping failed: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
