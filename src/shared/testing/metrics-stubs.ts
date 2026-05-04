import type { Counter, Histogram, Gauge } from 'prom-client';
import type { PinoLogger } from 'nestjs-pino';

export const stubCounter = (): Counter<string> =>
  ({ inc: () => undefined }) as unknown as Counter<string>;

export const stubGauge = (): Gauge<string> =>
  ({ set: () => undefined, inc: () => undefined, dec: () => undefined }) as unknown as Gauge<string>;

export const stubHistogram = (): Histogram<string> =>
  ({
    startTimer: () => () => undefined,
    observe: () => undefined,
  }) as unknown as Histogram<string>;

export const stubPinoLogger = (): PinoLogger =>
  ({
    setContext: () => undefined,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
  }) as unknown as PinoLogger;
