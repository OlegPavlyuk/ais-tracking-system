import { EventEmitter } from 'node:events';
import { Counter, Registry } from 'prom-client';
import WebSocket from 'ws';
import { ConfigService } from '../../shared/config/config.service';
import { AisStreamAdapter } from './aisstream.adapter';
import { AISSTREAM_ACCEPTED_MESSAGE_TYPES } from './aisstream.message-types';
import { AisStreamRawFilter } from './aisstream.raw-filter';
import { BLACK_SEA_BBOX } from '../../shared/config/constants';

class FakeSocket extends EventEmitter {
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', 1000, Buffer.from('test'));
  });
  readyState: number = WebSocket.CONNECTING;

  open() {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }
  message(payload: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }
  remoteClose() {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', 1006, Buffer.from('abnormal'));
  }
}

function makeConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): ConfigService {
  return new ConfigService({
    DATABASE_URL: 'postgres://x:y@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    AISSTREAM_API_KEY: 'test-key',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

function makeCounter(): Counter<'reason'> {
  return new Counter({
    name: 'test_dropped_total',
    help: 'h',
    labelNames: ['reason'] as const,
    registers: [new Registry()],
  });
}

function counterValue(counter: Counter<'reason'>, reason: string): number {
  // @ts-expect-error access internal hashmap for test-time inspection
  const entries = Object.values(counter.hashMap) as Array<{ value: number; labels: { reason: string } }>;
  return entries.filter((e) => e.labels.reason === reason).reduce((s, e) => s + e.value, 0);
}

describe('AisStreamAdapter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('throws on start() when AISSTREAM_API_KEY is missing (fail-fast)', () => {
    const factory = jest.fn();
    const adapter = new AisStreamAdapter(
      makeConfig({ AISSTREAM_API_KEY: undefined }),
      new AisStreamRawFilter(),
      makeCounter(),
      { webSocketFactory: factory },
    );
    expect(() => adapter.start()).toThrow(/AISSTREAM_API_KEY is required/);
    expect(factory).not.toHaveBeenCalled();
    expect(adapter.health()).toMatchObject({ connected: false, lastMessageAt: null });
  });

  it('emits accepted raw messages and increments drop counter for filtered ones', () => {
    const handler = jest.fn();
    const counter = makeCounter();
    const sockets: FakeSocket[] = [];
    const factory = (_url: string) => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    };
    const adapter = new AisStreamAdapter(makeConfig(), new AisStreamRawFilter(), counter, {
      webSocketFactory: factory,
    });
    adapter.onMessage(handler);
    adapter.start();
    sockets[0]!.open();

    const accepted = {
      MessageType: 'PositionReport',
      Message: { PositionReport: { UserID: 241935000 } },
      MetaData: { MMSI: 241935000 },
    };
    const filteredOut = {
      MessageType: 'BaseStationReport',
      Message: { BaseStationReport: {} },
      MetaData: { MMSI: 2130100 },
    };
    sockets[0]!.message(accepted);
    sockets[0]!.message(filteredOut);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ provider: 'aisstream', payload: accepted });
    expect(counterValue(counter, 'non_vessel_mmsi')).toBe(1);
    expect(adapter.health().lastMessageAt).not.toBeNull();
  });

  it('reconnects with exponential backoff and resets attempt only after a real message', () => {
    const sockets: FakeSocket[] = [];
    const factory = (_url: string) => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    };
    const adapter = new AisStreamAdapter(makeConfig(), new AisStreamRawFilter(), makeCounter(), {
      webSocketFactory: factory,
    });
    adapter.start();

    // Connection 1 closes before any message → attempt=0 used (1s ± 20%), reconnectCount becomes 1
    sockets[0]!.open();
    sockets[0]!.remoteClose();
    expect(adapter.health().reconnectCount).toBe(1);
    jest.advanceTimersByTime(2_000);
    expect(sockets.length).toBe(2);

    // Connection 2 closes again before any message → attempt=1 (~2s)
    sockets[1]!.open();
    sockets[1]!.remoteClose();
    expect(adapter.health().reconnectCount).toBe(2);
    jest.advanceTimersByTime(4_000);
    expect(sockets.length).toBe(3);

    // Connection 3 receives a message → attempt counter resets
    sockets[2]!.open();
    sockets[2]!.message({
      MessageType: 'PositionReport',
      Message: { PositionReport: { UserID: 241935000 } },
      MetaData: { MMSI: 241935000 },
    });
    sockets[2]!.remoteClose();
    expect(adapter.health().reconnectCount).toBe(3);
    // After reset, the next reconnect uses attempt=0 again (~1s).
    jest.advanceTimersByTime(2_000);
    expect(sockets.length).toBe(4);
  });

  it('stop cancels pending reconnect and closes the socket without further attempts', async () => {
    const sockets: FakeSocket[] = [];
    const factory = (_url: string) => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    };
    const adapter = new AisStreamAdapter(makeConfig(), new AisStreamRawFilter(), makeCounter(), {
      webSocketFactory: factory,
    });
    adapter.start();
    sockets[0]!.open();
    sockets[0]!.remoteClose();
    expect(sockets).toHaveLength(1);

    await adapter.stop();
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('subscribes with [latitude, longitude] corners (regression: AISStream uses lat/lon, not lon/lat)', () => {
    const sockets: FakeSocket[] = [];
    const factory = (_url: string) => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    };
    const adapter = new AisStreamAdapter(makeConfig(), new AisStreamRawFilter(), makeCounter(), {
      webSocketFactory: factory,
    });
    adapter.start();
    sockets[0]!.open();

    expect(sockets[0]!.send).toHaveBeenCalledTimes(1);
    const sub = JSON.parse(sockets[0]!.send.mock.calls[0][0] as string);
    expect(sub.APIKey).toBe('test-key');
    expect(sub.BoundingBoxes).toEqual([
      [
        [BLACK_SEA_BBOX.minLat, BLACK_SEA_BBOX.minLon],
        [BLACK_SEA_BBOX.maxLat, BLACK_SEA_BBOX.maxLon],
      ],
    ]);
    expect(sub.FilterMessageTypes).toEqual(AISSTREAM_ACCEPTED_MESSAGE_TYPES);
    // Sanity: each corner's first element is a latitude (|lat| <= 90) and second
    // is a longitude (|lon| <= 180) — but for the Black Sea, |lat| < |lon| is
    // impossible since both are in (27, 47), so we rely on the explicit equality
    // above and on the constant being well-formed.
    for (const corner of sub.BoundingBoxes[0]) {
      expect(corner[0]).toBeGreaterThanOrEqual(-90);
      expect(corner[0]).toBeLessThanOrEqual(90);
      expect(corner[1]).toBeGreaterThanOrEqual(-180);
      expect(corner[1]).toBeLessThanOrEqual(180);
    }
  });

  it('reports connected from socket.readyState', () => {
    const sockets: FakeSocket[] = [];
    const factory = (_url: string) => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    };
    const adapter = new AisStreamAdapter(makeConfig(), new AisStreamRawFilter(), makeCounter(), {
      webSocketFactory: factory,
    });
    expect(adapter.health().connected).toBe(false);
    adapter.start();
    sockets[0]!.open();
    expect(adapter.health().connected).toBe(true);
  });
});
