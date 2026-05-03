import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminTokenGuard } from './admin-token.guard';
import type { ConfigService } from '../shared/config/config.service';

function makeContext(headers: Record<string, string | undefined>): ExecutionContext {
  const req = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeConfig(opts: { token?: string; nodeEnv: 'development' | 'test' | 'production' }): ConfigService {
  return {
    get: jest.fn((k: string) => {
      if (k === 'ADMIN_TOKEN') return opts.token;
      if (k === 'NODE_ENV') return opts.nodeEnv;
      throw new Error(`unexpected ${k}`);
    }),
  } as unknown as ConfigService;
}

describe('AdminTokenGuard', () => {
  it('allows when ADMIN_TOKEN unset and NODE_ENV=development', () => {
    const guard = new AdminTokenGuard(makeConfig({ nodeEnv: 'development' }));
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('rejects when ADMIN_TOKEN unset and NODE_ENV=production', () => {
    const guard = new AdminTokenGuard(makeConfig({ nodeEnv: 'production' }));
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });

  it('allows when header matches token exactly', () => {
    const token = 'a'.repeat(32);
    const guard = new AdminTokenGuard(makeConfig({ token, nodeEnv: 'production' }));
    expect(guard.canActivate(makeContext({ 'x-admin-token': token }))).toBe(true);
  });

  it('rejects when header missing while token configured', () => {
    const guard = new AdminTokenGuard(makeConfig({ token: 'secret-1234', nodeEnv: 'development' }));
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });

  it('rejects on mismatched token (same length) without throwing crypto error', () => {
    const token = 'a'.repeat(20);
    const guard = new AdminTokenGuard(makeConfig({ token, nodeEnv: 'production' }));
    expect(() => guard.canActivate(makeContext({ 'x-admin-token': 'b'.repeat(20) }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects on mismatched length without throwing on timingSafeEqual', () => {
    const token = 'a'.repeat(32);
    const guard = new AdminTokenGuard(makeConfig({ token, nodeEnv: 'production' }));
    expect(() => guard.canActivate(makeContext({ 'x-admin-token': 'short' }))).toThrow(
      UnauthorizedException,
    );
  });
});
