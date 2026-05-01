import { ServerMessage } from './protocol';

export type EnqueueResult =
  | { ok: true; superseded: boolean; evictedQueueOverflow: boolean }
  | { ok: false; reason: 'queue_overflow' };

export interface SendQueueOptions {
  maxEntries: number;
}

/**
 * Two-tier per-connection queue.
 * - Position messages: held in a Map keyed by mmsi so a newer position naturally
 *   supersedes an older one for the same vessel (the dropped older counts as
 *   `superseded`).
 * - Static and vessel.enriched: held in a FIFO and never silently dropped.
 *   When the combined size would exceed the cap and the new message is static
 *   or enriched, enqueue returns `queue_overflow` so the gateway can disconnect.
 */
export class SendQueue {
  private readonly positions = new Map<string, ServerMessage>();
  private readonly others: ServerMessage[] = [];

  constructor(private readonly opts: SendQueueOptions) {}

  size(): number {
    return this.positions.size + this.others.length;
  }

  enqueue(msg: ServerMessage): EnqueueResult {
    if (msg.type === 'position') {
      const mmsi = msg.data.mmsi;
      const hadEntry = this.positions.has(mmsi);
      if (hadEntry) {
        this.positions.set(mmsi, msg);
        return { ok: true, superseded: true, evictedQueueOverflow: false };
      }
      let evictedQueueOverflow = false;
      if (this.size() >= this.opts.maxEntries) {
        const oldestKey = this.positions.keys().next().value;
        if (oldestKey !== undefined) {
          this.positions.delete(oldestKey);
          evictedQueueOverflow = true;
        } else {
          // No position to evict; queue is full of statics — refuse.
          return { ok: false, reason: 'queue_overflow' };
        }
      }
      this.positions.set(mmsi, msg);
      return { ok: true, superseded: false, evictedQueueOverflow };
    }

    if (msg.type === 'static' || msg.type === 'vessel.enriched') {
      if (this.size() >= this.opts.maxEntries) {
        return { ok: false, reason: 'queue_overflow' };
      }
      this.others.push(msg);
      return { ok: true, superseded: false, evictedQueueOverflow: false };
    }

    if (this.size() >= this.opts.maxEntries) {
      return { ok: false, reason: 'queue_overflow' };
    }
    this.others.push(msg);
    return { ok: true, superseded: false, evictedQueueOverflow: false };
  }

  /** Drain returns statics/enriched first (priority), then positions. */
  drain(): ServerMessage[] {
    const out: ServerMessage[] = [];
    while (this.others.length > 0) out.push(this.others.shift()!);
    for (const m of this.positions.values()) out.push(m);
    this.positions.clear();
    return out;
  }
}
