import { HealthService } from './health.service';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

const fakeDb = (ok: boolean): DbService => ({ ping: jest.fn().mockResolvedValue(ok) }) as unknown as DbService;
const fakeRedis = (ok: boolean): RedisService =>
  ({ ping: jest.fn().mockResolvedValue(ok) }) as unknown as RedisService;

describe('HealthService', () => {
  it('liveness is unconditional', () => {
    const svc = new HealthService(fakeDb(false), fakeRedis(false));
    expect(svc.liveness()).toEqual({ alive: true });
  });

  it('readiness is true only when both DB and Redis are reachable', async () => {
    const svc = new HealthService(fakeDb(true), fakeRedis(true));
    const r = await svc.readiness();
    expect(r.ready).toBe(true);
    expect(r.checks).toEqual({ db: true, redis: true });
    expect(r.feedDegraded).toBe(false);
  });

  it('readiness is false if DB is down', async () => {
    const svc = new HealthService(fakeDb(false), fakeRedis(true));
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.checks.db).toBe(false);
  });

  it('readiness is false if Redis is down', async () => {
    const svc = new HealthService(fakeDb(true), fakeRedis(false));
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.checks.redis).toBe(false);
  });
});
