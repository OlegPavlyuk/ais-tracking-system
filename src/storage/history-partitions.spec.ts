import {
  createPartitionSql,
  historyPartitionWindow,
  historyRetentionCutoffDay,
  isHistoryEventRetained,
  nextDailyMaintenanceDelayMs,
  parseHistoryPartitionDay,
  planHistoryPartitionMaintenance,
  partitionNameForDay,
  utcDayStart,
} from './history-partitions';

describe('history partition planning', () => {
  const policy = { retentionDays: 7, safetyDays: 1, precreateDays: 7 };

  it('uses UTC day boundaries for names and ranges', () => {
    const day = utcDayStart(new Date('2026-05-14T23:59:59.999Z'));
    expect(day.toISOString()).toBe('2026-05-14T00:00:00.000Z');
    expect(partitionNameForDay(day)).toBe('vessel_positions_history_y2026m05d14');
    expect(createPartitionSql(day)).toContain(
      `FOR VALUES FROM ('2026-05-14T00:00:00.000Z') TO ('2026-05-15T00:00:00.000Z')`,
    );
  });

  it('plans retained days through the future precreate buffer', () => {
    const window = historyPartitionWindow(new Date('2026-05-14T12:00:00.000Z'), policy);
    expect(window.cutoffDay.toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(window.lastFutureDay.toISOString()).toBe('2026-05-21T00:00:00.000Z');
    expect(window.days).toHaveLength(16);
  });

  it('parses daily partition names and rejects non-daily names', () => {
    expect(parseHistoryPartitionDay('vessel_positions_history_y2026m05d14')?.toISOString()).toBe(
      '2026-05-14T00:00:00.000Z',
    );
    expect(parseHistoryPartitionDay('vessel_positions_history_y2026m05')).toBeNull();
  });

  it('classifies events older than retention plus safety as not retained', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');
    expect(historyRetentionCutoffDay(now, policy).toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(isHistoryEventRetained('2026-05-06T00:00:00.000Z', now, policy)).toBe(true);
    expect(isHistoryEventRetained('2026-05-05T23:59:59.999Z', now, policy)).toBe(false);
  });

  it('schedules daily maintenance at the next requested UTC time', () => {
    expect(nextDailyMaintenanceDelayMs(new Date('2026-05-14T00:04:00.000Z'), 0, 5)).toBe(60_000);
    expect(nextDailyMaintenanceDelayMs(new Date('2026-05-14T00:06:00.000Z'), 0, 5)).toBe(
      23 * 60 * 60 * 1000 + 59 * 60 * 1000,
    );
  });

  it('plans create and drop DDL from existing partitions', () => {
    const plan = planHistoryPartitionMaintenance(
      [
        'vessel_positions_history_y2026m05d05',
        'vessel_positions_history_y2026m05d06',
        'vessel_positions_history_y2026m05',
      ],
      new Date('2026-05-14T12:00:00.000Z'),
      policy,
    );

    expect(plan.create).toHaveLength(16);
    expect(plan.create.map((p) => p.name)).toContain('vessel_positions_history_y2026m05d14');
    expect(plan.drop.map((p) => p.name)).toEqual(['vessel_positions_history_y2026m05d05']);
    expect(plan.cutoffDay.toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(plan.lastFutureDay.toISOString()).toBe('2026-05-21T00:00:00.000Z');
  });
});
