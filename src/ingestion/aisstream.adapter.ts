import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { ConfigService } from '../shared/config/config.service';
import { BLACK_SEA_BBOX } from '../shared/config/constants';
import { RawProviderMessage } from '../contracts';

const STREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const PROVIDER_ID = 'aisstream';

export type RawMessageHandler = (msg: RawProviderMessage<unknown>) => void;

/**
 * AISStream WebSocket connector. Slice #2 keeps it intentionally minimal:
 * connect once, push raw messages to subscribers, log on disconnect.
 * Reconnect/backoff/health metrics land in slice #11.
 */
@Injectable()
export class AisStreamAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AisStreamAdapter.name);
  private readonly emitter = new EventEmitter();
  private socket: WebSocket | null = null;
  private closing = false;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  onMessage(handler: RawMessageHandler): void {
    this.emitter.on('raw', handler);
  }

  async onModuleInit(): Promise<void> {
    const providers = this.config.get('AIS_PROVIDERS');
    if (!providers.includes(PROVIDER_ID)) {
      this.logger.log(`AISStream adapter inactive (AIS_PROVIDERS=${providers.join(',') || 'none'})`);
      return;
    }
    const apiKey = this.config.get('AISSTREAM_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'AISSTREAM_API_KEY not set — AISStream adapter will not connect. Live ingestion disabled.',
      );
      return;
    }
    this.connect(apiKey);
  }

  private connect(apiKey: string): void {
    this.logger.log(`connecting to AISStream at ${STREAM_URL}`);
    const socket = new WebSocket(STREAM_URL);
    this.socket = socket;

    socket.on('open', () => {
      const sub = {
        APIKey: apiKey,
        BoundingBoxes: [
          [
            [BLACK_SEA_BBOX.minLon, BLACK_SEA_BBOX.minLat],
            [BLACK_SEA_BBOX.maxLon, BLACK_SEA_BBOX.maxLat],
          ],
        ],
      };
      socket.send(JSON.stringify(sub));
      this.logger.log('AISStream subscribed to Black Sea bbox');
    });

    socket.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString());
        this.emitter.emit('raw', {
          provider: PROVIDER_ID,
          receivedAt: new Date().toISOString(),
          payload,
        } satisfies RawProviderMessage);
      } catch (err) {
        this.logger.warn(`failed to parse AISStream message: ${(err as Error).message}`);
      }
    });

    socket.on('error', (err) => {
      this.logger.warn(`AISStream socket error: ${err.message}`);
    });

    socket.on('close', (code, reason) => {
      this.socket = null;
      if (this.closing) return;
      this.logger.warn(`AISStream connection closed (code=${code}, reason=${reason.toString() || 'none'})`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    this.socket?.close();
    this.emitter.removeAllListeners();
  }
}
