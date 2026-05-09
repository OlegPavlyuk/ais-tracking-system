import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient } from './wsClient';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly OPEN = FakeWebSocket.OPEN;
  readyState = FakeWebSocket.OPEN;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  emitOpen() {
    this.onopen?.();
  }

  emitClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('WsClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('sends subscribe without bbox payload on open and reconnect', () => {
    const client = new WsClient(
      { url: 'ws://localhost/ws/positions', WebSocketImpl: FakeWebSocket as never, rng: () => 0 },
      { onMessage: vi.fn(), onStatus: vi.fn(), onResync: vi.fn() },
    );

    client.start();
    FakeWebSocket.instances[0]!.emitOpen();
    expect(FakeWebSocket.instances[0]!.send).toHaveBeenCalledWith('{"type":"subscribe"}');

    FakeWebSocket.instances[0]!.emitClose();
    vi.runOnlyPendingTimers();

    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.emitOpen();
    expect(FakeWebSocket.instances[1]!.send).toHaveBeenCalledWith('{"type":"subscribe"}');
  });
});
