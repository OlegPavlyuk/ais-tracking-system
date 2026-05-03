import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { ConfigService } from '../../shared/config/config.service';
import { BLACK_SEA_BBOX } from '../../shared/config/constants';
import { RawProviderMessage } from '../../contracts';
import {
  AIS_MESSAGES_DROPPED_TOTAL,
  DropReason,
} from '../../shared/metrics/drop-reasons';
import { ProviderHealth } from '../../shared/health/provider-health';
import { AisProviderAdapter, RawMessageHandler } from '../provider';
import { nextBackoffMs } from '../backoff';
import { AisStreamRawFilter } from './aisstream.raw-filter';

const STREAM_URL = 'wss://stream.aisstream.io/v0/stream';
export const AISSTREAM_PROVIDER_ID = 'aisstream';

interface AdapterDeps {
  webSocketFactory?: (url: string) => WebSocket;
}

@Injectable()
export class AisStreamAdapter implements AisProviderAdapter {
  readonly id = AISSTREAM_PROVIDER_ID;

  private readonly logger = new Logger(AisStreamAdapter.name);
  private readonly emitter = new EventEmitter();
  private readonly webSocketFactory: (url: string) => WebSocket;

  private socket: WebSocket | null = null;
  private closing = false;
  private started = false;

  private startedAt: string | null = null;
  private lastMessageAt: string | null = null;
  private reconnectCount = 0;
  private connectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private apiKey: string | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AisStreamRawFilter) private readonly filter: AisStreamRawFilter,
    @InjectMetric(AIS_MESSAGES_DROPPED_TOTAL)
    private readonly droppedCounter: Counter<'reason'>,
    @Optional() deps?: AdapterDeps,
  ) {
    this.webSocketFactory = deps?.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  onMessage(handler: RawMessageHandler): void {
    this.emitter.on('raw', handler);
  }

  start(): void {
    if (this.started) return;
    const apiKey = this.config.get('AISSTREAM_API_KEY');
    if (!apiKey) {
      throw new Error(
        'AISSTREAM_API_KEY is required when AIS_PROVIDERS includes "aisstream". Either set the key or remove "aisstream" from AIS_PROVIDERS.',
      );
    }
    this.apiKey = apiKey;
    this.started = true;
    this.startedAt = new Date().toISOString();
    this.connect();
  }

  async stop(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.emitter.removeAllListeners();
  }

  health(): ProviderHealth {
    return {
      providerId: this.id,
      connected: this.socket?.readyState === WebSocket.OPEN,
      lastMessageAt: this.lastMessageAt,
      reconnectCount: this.reconnectCount,
      startedAt: this.startedAt,
    };
  }

  private connect(): void {
    if (this.closing || !this.apiKey) return;
    this.logger.log(`connecting to AISStream at ${STREAM_URL} (attempt=${this.connectAttempt})`);
    const socket = this.webSocketFactory(STREAM_URL);
    this.socket = socket;

    socket.on('open', () => {
      const sub = {
        APIKey: this.apiKey,
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
      let payload: unknown;
      try {
        payload = JSON.parse(data.toString());
      } catch (err) {
        this.logger.warn(`failed to parse AISStream message: ${(err as Error).message}`);
        this.dropCounter('invalid');
        return;
      }
      // First successful frame after open → backoff resets.
      this.lastMessageAt = new Date().toISOString();
      this.connectAttempt = 0;

      const verdict = this.filter.accept(payload);
      if (!verdict.accepted) {
        this.dropCounter(verdict.reason);
        return;
      }
      const msg: RawProviderMessage = {
        provider: this.id,
        receivedAt: this.lastMessageAt,
        payload,
      };
      this.emitter.emit('raw', msg);
    });

    socket.on('error', (err) => {
      this.logger.warn(`AISStream socket error: ${err.message}`);
    });

    socket.on('close', (code, reason) => {
      this.socket = null;
      if (this.closing) return;
      this.logger.warn(
        `AISStream connection closed (code=${code}, reason=${reason.toString() || 'none'})`,
      );
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closing) return;
    this.reconnectCount += 1;
    const delay = nextBackoffMs(this.connectAttempt);
    this.connectAttempt += 1;
    this.logger.log(`AISStream reconnect scheduled in ${delay}ms (attempt=${this.connectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private dropCounter(reason: DropReason): void {
    this.droppedCounter.inc({ reason });
  }
}
