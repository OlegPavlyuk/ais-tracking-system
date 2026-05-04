import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram } from 'prom-client';
import { Observable, tap } from 'rxjs';
import { HTTP_REQUEST_DURATION_SECONDS } from './metric-names';

/**
 * Records http_request_duration_seconds{route,method,status}. Route is built
 * from the controller class + handler `@Path` metadata so the label is the
 * route template (e.g. `/api/vessels/:id`), keeping label cardinality bounded.
 * Falls back to the raw URL when metadata is unavailable (non-controller
 * paths). Skips the metrics endpoint itself.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric(HTTP_REQUEST_DURATION_SECONDS)
    private readonly histogram: Histogram<'route' | 'method' | 'status'>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<{ method?: string; url?: string }>();
    const route = this.routeFor(context, req.url);
    if (route === '/metrics') return next.handle();
    const method = (req.method ?? 'GET').toUpperCase();
    const end = this.histogram.startTimer({ route, method });
    return next.handle().pipe(
      tap({
        next: () => end({ status: String(http.getResponse<{ statusCode?: number }>().statusCode ?? 200) }),
        error: (err: unknown) => {
          const status =
            typeof (err as { status?: number })?.status === 'number'
              ? String((err as { status: number }).status)
              : '500';
          end({ status });
        },
      }),
    );
  }

  private routeFor(context: ExecutionContext, fallback?: string): string {
    const cls = context.getClass();
    const handler = context.getHandler();
    const controllerPath = (Reflect.getMetadata('path', cls) as string | undefined) ?? '';
    const handlerPath = (Reflect.getMetadata('path', handler) as string | undefined) ?? '';
    const joined = `/${controllerPath}/${handlerPath}`.replace(/\/+/g, '/').replace(/\/$/, '');
    if (joined && joined !== '/') return joined;
    return fallback ?? 'unknown';
  }
}
