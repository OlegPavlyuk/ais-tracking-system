import { WebSocket } from 'ws';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway message handling', () => {
  function makeGateway() {
    const subs = {
      add: jest.fn(),
      remove: jest.fn(),
      forEachSubscribed: jest.fn(),
    };
    const messagesDropped = { inc: jest.fn() };
    const messagesSent = { inc: jest.fn() };
    const connectionsActive = { inc: jest.fn(), dec: jest.fn() };
    const subscriptionsAccepted = { inc: jest.fn() };

    const gateway = new RealtimeGateway(
      {} as never,
      {} as never,
      subs as never,
      connectionsActive as never,
      messagesSent as never,
      messagesDropped as never,
      subscriptionsAccepted as never,
    );

    return {
      gateway: gateway as unknown as { handleMessage: (conn: unknown, raw: string) => void },
      subs,
      messagesDropped,
      messagesSent,
      subscriptionsAccepted,
    };
  }

  function makeConnection() {
    return {
      id: 'conn-1',
      ws: {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      },
    };
  }

  it('accepts subscribe-only websocket messages', () => {
    const { gateway, subs, subscriptionsAccepted } = makeGateway();
    const conn = makeConnection();

    gateway.handleMessage(conn, JSON.stringify({ type: 'subscribe' }));

    expect(subs.add).toHaveBeenCalledWith('conn-1');
    expect(subscriptionsAccepted.inc).toHaveBeenCalled();
    expect(conn.ws.send).not.toHaveBeenCalled();
  });

  it('rejects stale subscribe payloads that still include bbox', () => {
    const { gateway, subs, messagesDropped, messagesSent } = makeGateway();
    const conn = makeConnection();

    gateway.handleMessage(conn, JSON.stringify({ type: 'subscribe', bbox: '27,40.5,42.5,47.5' }));

    expect(subs.add).not.toHaveBeenCalled();
    expect(messagesDropped.inc).toHaveBeenCalledWith({ reason: 'invalid_payload' });
    expect(messagesSent.inc).toHaveBeenCalledWith({ kind: 'error' });
    expect(conn.ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"code":"INVALID_MESSAGE"'),
    );
  });

  it('rejects retired update_subscription websocket messages', () => {
    const { gateway, subs, messagesDropped } = makeGateway();
    const conn = makeConnection();

    gateway.handleMessage(
      conn,
      JSON.stringify({ type: 'update_subscription', bbox: '27,40.5,42.5,47.5' }),
    );

    expect(subs.add).not.toHaveBeenCalled();
    expect(messagesDropped.inc).toHaveBeenCalledWith({ reason: 'invalid_payload' });
    expect(conn.ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"code":"INVALID_MESSAGE"'),
    );
  });
});
