/**
 * Transport-agnostic event bus seam. RedisStreams is the MVP implementation;
 * the interface keeps a Rabbit swap path open.
 */
export interface EventBusMessage<T = unknown> {
  id: string;
  payload: T;
}

export type EventBusHandler<T = unknown> = (msg: EventBusMessage<T>) => Promise<void>;

export interface EventBus {
  publish<T>(stream: string, payload: T): Promise<string>;
  subscribe<T>(stream: string, group: string, consumer: string, handler: EventBusHandler<T>): Promise<void>;
}

export const EVENT_BUS = Symbol('EVENT_BUS');
