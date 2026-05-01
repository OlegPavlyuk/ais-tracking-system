import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { WebSocket, WebSocketServer } from 'ws';
import { ConfigService } from '../shared/config/config.service';
import {
  WS_CONNECTIONS_ACTIVE,
  WS_MESSAGES_DROPPED_TOTAL,
  WS_MESSAGES_SENT_TOTAL,
  WS_SUBSCRIBER_BBOX_UPDATES_TOTAL,
} from '../shared/metrics/ws-metrics';
import { ClientMessageSchema, ServerMessage } from './protocol';
import { SendQueue } from './send-queue';
import { SubscriptionService } from './subscription.service';

const WS_PATH = '/ws/positions';

interface Connection {
  id: string;
  ws: WebSocket;
  queue: SendQueue;
  alive: boolean;
}

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly connections = new Map<string, Connection>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ConfigService,
    private readonly subs: SubscriptionService,
    @InjectMetric(WS_CONNECTIONS_ACTIVE) private readonly connectionsActive: Gauge<string>,
    @InjectMetric(WS_MESSAGES_SENT_TOTAL) private readonly messagesSent: Counter<'kind'>,
    @InjectMetric(WS_MESSAGES_DROPPED_TOTAL) private readonly messagesDropped: Counter<'reason'>,
    @InjectMetric(WS_SUBSCRIBER_BBOX_UPDATES_TOTAL) private readonly bboxUpdates: Counter<string>,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer();
    if (!httpServer) {
      this.logger.warn('no http server available; WS gateway not started');
      return;
    }
    this.wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.logger.log(`WebSocket gateway listening on ${WS_PATH}`);

    const intervalMs = this.config.get('WS_HEARTBEAT_INTERVAL_MS');
    this.heartbeat = setInterval(() => this.tickHeartbeat(), intervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const conn of this.connections.values()) {
      try {
        conn.ws.close(1001, 'server shutdown');
      } catch {
        // ignore
      }
    }
    this.connections.clear();
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
  }

  /**
   * Route a server-side event to a single connection. Used by FanoutConsumer.
   * Disconnects the connection on non-droppable overflow.
   */
  enqueue(connectionId: string, msg: ServerMessage): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    const r = conn.queue.enqueue(msg);
    if (!r.ok) {
      this.messagesDropped.inc({ reason: r.reason });
      this.logger.warn(`disconnecting ${connectionId}: queue overflow on ${msg.type}`);
      this.sendError(conn, 'QUEUE_OVERFLOW', 'send queue overflowed; client too slow');
      conn.ws.close(1013, 'queue overflow');
      this.cleanup(conn);
      return;
    }
    if (r.superseded) this.messagesDropped.inc({ reason: 'superseded' });
    if (r.evictedQueueOverflow) this.messagesDropped.inc({ reason: 'queue_overflow' });
    this.flush(conn);
  }

  private flush(conn: Connection): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    const limit = this.config.get('WS_BUFFERED_AMOUNT_LIMIT_BYTES');
    if (conn.ws.bufferedAmount >= limit) return;
    const drained = conn.queue.drain();
    for (const msg of drained) {
      conn.ws.send(JSON.stringify(msg));
      this.messagesSent.inc({ kind: msg.type });
    }
  }

  private handleConnection(ws: WebSocket): void {
    const id = randomUUID();
    const conn: Connection = {
      id,
      ws,
      queue: new SendQueue({ maxEntries: this.config.get('WS_SEND_QUEUE_MAX') }),
      alive: true,
    };
    this.connections.set(id, conn);
    this.connectionsActive.inc();
    this.logger.log(`WS connect id=${id} (active=${this.connections.size})`);

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('message', (raw) => this.handleMessage(conn, raw.toString()));

    ws.on('close', () => this.cleanup(conn));
    ws.on('error', (err) => {
      this.logger.warn(`WS error id=${id}: ${err.message}`);
      this.cleanup(conn);
    });
  }

  private handleMessage(conn: Connection, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.messagesDropped.inc({ reason: 'invalid_payload' });
      this.sendError(conn, 'INVALID_PAYLOAD', 'message must be JSON');
      return;
    }
    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.messagesDropped.inc({ reason: 'invalid_payload' });
      this.sendError(
        conn,
        'INVALID_MESSAGE',
        result.error.issues[0]?.message ?? 'invalid message',
        result.error.issues,
      );
      return;
    }
    this.subs.set(conn.id, result.data.bbox);
    this.bboxUpdates.inc();
  }

  private tickHeartbeat(): void {
    for (const conn of this.connections.values()) {
      if (!conn.alive) {
        this.logger.warn(`heartbeat timeout id=${conn.id}; terminating`);
        try {
          conn.ws.terminate();
        } catch {
          // ignore
        }
        this.cleanup(conn);
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        this.cleanup(conn);
      }
    }
  }

  private sendError(conn: Connection, code: string, message: string, details?: unknown): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    const envelope: ServerMessage = {
      type: 'error',
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    };
    conn.ws.send(JSON.stringify(envelope));
    this.messagesSent.inc({ kind: 'error' });
  }

  private cleanup(conn: Connection): void {
    if (!this.connections.delete(conn.id)) return;
    this.subs.remove(conn.id);
    this.connectionsActive.dec();
    this.logger.log(`WS disconnect id=${conn.id} (active=${this.connections.size})`);
  }
}
