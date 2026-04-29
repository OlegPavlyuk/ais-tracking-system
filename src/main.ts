import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as NestLogger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigService } from './shared/config/config.service';

async function bootstrap() {
  // Validate env before Nest spins up so misconfig fails fast.
  const config = new ConfigService(process.env);
  const role = config.get('PROCESS_ROLE');
  const port = config.get('PORT');

  const app = await NestFactory.create(AppModule.forRole(role), { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  await app.listen(port);
  NestLogger.log(`AIS tracking system listening on :${port} (role=${role})`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
