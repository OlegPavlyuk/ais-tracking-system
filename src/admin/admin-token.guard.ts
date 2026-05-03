import { CanActivate, ExecutionContext, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '../shared/config/config.service';

const HEADER = 'x-admin-token';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  private readonly logger = new Logger(AdminTokenGuard.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('ADMIN_TOKEN');
    const nodeEnv = this.config.get('NODE_ENV');
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const provided = readHeader(req.headers[HEADER]);

    if (!expected) {
      if (nodeEnv === 'development') return true;
      this.logger.warn(`admin endpoint blocked: ADMIN_TOKEN unset in NODE_ENV=${nodeEnv}`);
      throw new UnauthorizedException('admin endpoint disabled');
    }

    if (!provided) throw new UnauthorizedException('admin token required');

    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.byteLength !== b.byteLength) throw new UnauthorizedException('invalid admin token');
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException('invalid admin token');
    return true;
  }
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
