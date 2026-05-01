import { SendQueue } from './send-queue';
import { PositionEvent, SCHEMA_VERSION, StaticEvent } from '../contracts';
import { ServerMessage } from './protocol';

function pos(mmsi: string, lat = 41.5): PositionEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'position',
    mmsi,
    lat,
    lon: 32.0,
    occurredAt: '2026-04-28T00:00:00.000Z',
    provider: 'aisstream',
    ingestedAt: '2026-04-28T00:00:00.100Z',
  };
}

function stat(mmsi: string): StaticEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'static',
    mmsi,
    name: 'X',
    occurredAt: '2026-04-28T00:00:00.000Z',
    provider: 'aisstream',
    ingestedAt: '2026-04-28T00:00:00.100Z',
  };
}

const positionMsg = (mmsi: string): ServerMessage => ({ type: 'position', data: pos(mmsi) });
const staticMsg = (mmsi: string): ServerMessage => ({ type: 'static', data: stat(mmsi) });

describe('SendQueue', () => {
  it('adds a new position', () => {
    const q = new SendQueue({ maxEntries: 4 });
    const r = q.enqueue(positionMsg('111111111'));
    expect(r).toEqual({ ok: true, superseded: false, evictedQueueOverflow: false });
    expect(q.size()).toBe(1);
  });

  it('supersedes an older position for the same MMSI without growing', () => {
    const q = new SendQueue({ maxEntries: 4 });
    q.enqueue(positionMsg('111111111'));
    const r = q.enqueue(positionMsg('111111111'));
    expect(r).toEqual({ ok: true, superseded: true, evictedQueueOverflow: false });
    expect(q.size()).toBe(1);
  });

  it('evicts the oldest position to make room for a new MMSI when the cap is hit', () => {
    const q = new SendQueue({ maxEntries: 2 });
    q.enqueue(positionMsg('111111111'));
    q.enqueue(positionMsg('222222222'));
    const r = q.enqueue(positionMsg('333333333'));
    expect(r).toEqual({ ok: true, superseded: false, evictedQueueOverflow: true });
    expect(q.size()).toBe(2);
    const drained = q.drain();
    const mmsis = drained.map((m) => (m.type === 'position' ? m.data.mmsi : null));
    expect(mmsis).toEqual(['222222222', '333333333']);
  });

  it('queues a static event in FIFO and never drops it', () => {
    const q = new SendQueue({ maxEntries: 4 });
    q.enqueue(staticMsg('111111111'));
    q.enqueue(staticMsg('222222222'));
    const drained = q.drain();
    expect(drained.map((m) => (m.type === 'static' ? m.data.mmsi : null))).toEqual([
      '111111111',
      '222222222',
    ]);
  });

  it('returns queue_overflow rather than dropping a static', () => {
    const q = new SendQueue({ maxEntries: 2 });
    q.enqueue(staticMsg('111111111'));
    q.enqueue(staticMsg('222222222'));
    const r = q.enqueue(staticMsg('333333333'));
    expect(r).toEqual({ ok: false, reason: 'queue_overflow' });
  });

  it('refuses a new position MMSI when no position is available to evict', () => {
    const q = new SendQueue({ maxEntries: 2 });
    q.enqueue(staticMsg('111111111'));
    q.enqueue(staticMsg('222222222'));
    const r = q.enqueue(positionMsg('333333333'));
    expect(r).toEqual({ ok: false, reason: 'queue_overflow' });
  });

  it('drains statics first, then positions, then clears', () => {
    const q = new SendQueue({ maxEntries: 4 });
    q.enqueue(positionMsg('111111111'));
    q.enqueue(staticMsg('222222222'));
    q.enqueue(positionMsg('333333333'));
    const drained = q.drain();
    expect(drained.map((m) => m.type)).toEqual(['static', 'position', 'position']);
    expect(q.size()).toBe(0);
  });
});
