import { ServerMessageSchema, type ClientMessage, type ServerMessageParsed } from './protocol';
import { nextBackoffMs } from './backoff';

export type WsClientStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WsClientHandlers {
  onMessage: (msg: ServerMessageParsed) => void;
  onStatus: (status: WsClientStatus) => void;
  onResync: () => void;
}

export interface WsClientOptions {
  url: string;
  outageResyncMs?: number;
  WebSocketImpl?: typeof WebSocket;
  rng?: () => number;
}

const DEFAULT_OUTAGE_RESYNC_MS = 5000;

export class WsClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private receivedSinceOpen = false;
  private disconnectedAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(
    private readonly opts: WsClientOptions,
    private readonly handlers: WsClientHandlers,
  ) {}

  start(): void {
    this.closedByUser = false;
    this.connect();
  }

  stop(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.handlers.onStatus('closed');
  }

  private connect(): void {
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new Impl(this.opts.url);
    this.ws = ws;
    this.receivedSinceOpen = false;
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    ws.onopen = () => {
      this.send({ type: 'subscribe' });
      const outageMs = this.opts.outageResyncMs ?? DEFAULT_OUTAGE_RESYNC_MS;
      if (this.disconnectedAt !== null && Date.now() - this.disconnectedAt > outageMs) {
        this.handlers.onResync();
      }
      this.disconnectedAt = null;
      this.handlers.onStatus('open');
    };

    ws.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const result = ServerMessageSchema.safeParse(parsed);
      if (!result.success) {
        // drop silently; logging belongs to caller if needed
        return;
      }
      if (!this.receivedSinceOpen) {
        this.receivedSinceOpen = true;
        this.attempt = 0;
      }
      this.handlers.onMessage(result.data);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.disconnectedAt === null) this.disconnectedAt = Date.now();
      if (this.closedByUser) return;
      const delay = nextBackoffMs(this.attempt, this.opts.rng ? { rng: this.opts.rng } : {});
      this.attempt += 1;
      this.handlers.onStatus('reconnecting');
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => {
      // close handler drives the reconnect path
    };
  }

  private send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }
}

export function buildWsUrl(path: string, loc: Location = window.location): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}${path}`;
}
