import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get('NODE_ENV') !== 'production';
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL'),
            // Correlation fields (traceId/mmsi/vesselId/streamMessageId/
            // consumerGroup/provider) are bound on per-event log lines along
            // the AIS path via PinoLogger child contexts; see slice #12.
            base: {
              service: 'ais-tracking-system',
              role: config.get('PROCESS_ROLE'),
            },
            transport: isDev
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
