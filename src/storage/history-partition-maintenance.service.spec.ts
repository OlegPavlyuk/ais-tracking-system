import { HistoryPartitionMaintenanceService } from './history-partition-maintenance.service';
import { ConfigService } from '../shared/config/config.service';

describe('HistoryPartitionMaintenanceService', () => {
  function config(overrides: Partial<Record<string, unknown>> = {}): ConfigService {
    const values: Record<string, unknown> = {
      HISTORY_RETENTION_DAYS: 7,
      HISTORY_PRECREATE_DAYS: 7,
      HISTORY_PARTITION_MAINTENANCE_ENABLED: false,
      ...overrides,
    };
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  it('creates daily partitions and drops expired daily partitions under an advisory lock', async () => {
    const executed: string[] = [];
    let calls = 0;
    const tx = {
      execute: jest.fn(async (query: unknown) => {
        calls += 1;
        const text = String(query);
        executed.push(text);
        if (calls === 1) return [{ acquired: true }];
        if (calls === 2) {
          return [
            { name: 'vessel_positions_history_y2026m05d05' },
            { name: 'vessel_positions_history_y2026m05d06' },
            { name: 'vessel_positions_history_y2026m05' },
          ];
        }
        return [];
      }),
    };
    const dbs = {
      db: {
        transaction: jest.fn((cb) => cb(tx)),
      },
    };
    const service = new HistoryPartitionMaintenanceService(dbs as never, config());

    const result = await service.maintain(new Date('2026-05-14T12:00:00.000Z'));

    expect(result).toMatchObject({
      acquired: true,
      created: 16,
      dropped: 1,
      retainedFrom: '2026-05-06T00:00:00.000Z',
      precreatedThrough: '2026-05-21T00:00:00.000Z',
    });
    expect(executed).toHaveLength(19);
  });

  it('skips work when another process holds the advisory lock', async () => {
    const tx = {
      execute: jest.fn(async () => [{ acquired: false }]),
    };
    const dbs = {
      db: {
        transaction: jest.fn((cb) => cb(tx)),
      },
    };
    const service = new HistoryPartitionMaintenanceService(dbs as never, config());

    const result = await service.maintain(new Date('2026-05-14T12:00:00.000Z'));

    expect(result.acquired).toBe(false);
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});
