import 'reflect-metadata';
import { firstValueFrom, of, throwError } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

class TestController {
  handler(): void {
    /* no-op */
  }
}
Reflect.defineMetadata('path', 'api/vessels', TestController);
Reflect.defineMetadata('path', ':id', TestController.prototype.handler);

const makeContext = (req: { method?: string; url?: string }, statusCode = 200): ExecutionContext => {
  return {
    getType: () => 'http',
    getClass: () => TestController,
    getHandler: () => TestController.prototype.handler,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
};

describe('HttpMetricsInterceptor', () => {
  it('records duration with route template, method, and status on success', async () => {
    const observed: Array<Record<string, string>> = [];
    const histogram = {
      startTimer: (labels: Record<string, string>) => (final: Record<string, string>) =>
        observed.push({ ...labels, ...final }),
    } as never;
    const interceptor = new HttpMetricsInterceptor(histogram);
    const handler: CallHandler = { handle: () => of('ok') };
    const ctx = makeContext({ method: 'get', url: '/api/vessels/abc' }, 200);
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(observed).toEqual([{ route: '/api/vessels/:id', method: 'GET', status: '200' }]);
  });

  it('records error status when downstream throws an HttpException-like error', async () => {
    const observed: Array<Record<string, string>> = [];
    const histogram = {
      startTimer: (labels: Record<string, string>) => (final: Record<string, string>) =>
        observed.push({ ...labels, ...final }),
    } as never;
    const interceptor = new HttpMetricsInterceptor(histogram);
    const handler: CallHandler = {
      handle: () => throwError(() => Object.assign(new Error('not found'), { status: 404 })),
    };
    const ctx = makeContext({ method: 'GET', url: '/api/vessels/abc' });
    await firstValueFrom(interceptor.intercept(ctx, handler)).catch(() => undefined);
    expect(observed).toEqual([{ route: '/api/vessels/:id', method: 'GET', status: '404' }]);
  });

  it('skips /metrics', async () => {
    const observed: Array<Record<string, string>> = [];
    const histogram = {
      startTimer: () => () => observed.push({}),
    } as never;
    const interceptor = new HttpMetricsInterceptor(histogram);
    const ctx = {
      getType: () => 'http',
      getClass: () => class {},
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/metrics' }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('') };
    await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(observed).toEqual([]);
  });
});
