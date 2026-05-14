export const HISTORY_PARTITION_PARENT = 'vessel_positions_history';
export const HISTORY_PARTITION_LOCK_ID = 448_195_326_771;
export const HISTORY_RETENTION_SAFETY_DAYS = 1;
export const HISTORY_PARTITION_MAINTENANCE_UTC_HOUR = 0;
export const HISTORY_PARTITION_MAINTENANCE_UTC_MINUTE = 5;
export const HISTORY_PARTITION_MAINTENANCE_ON_STARTUP = true;

export interface HistoryPartitionPolicy {
  retentionDays: number;
  safetyDays: number;
  precreateDays: number;
}

export interface HistoryPartitionWindow {
  cutoffDay: Date;
  lastFutureDay: Date;
  days: Date[];
}

export interface HistoryPartitionPlan {
  cutoffDay: Date;
  lastFutureDay: Date;
  create: { day: Date; name: string; sql: string }[];
  drop: { day: Date; name: string; sql: string }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function assertWholeDay(day: Date): void {
  if (
    day.getUTCHours() !== 0 ||
    day.getUTCMinutes() !== 0 ||
    day.getUTCSeconds() !== 0 ||
    day.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`expected UTC day start, got ${day.toISOString()}`);
  }
}

export function utcDayStart(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export function addUtcDays(day: Date, days: number): Date {
  assertWholeDay(day);
  return new Date(day.getTime() + days * DAY_MS);
}

export function historyRetentionCutoffDay(
  now: Date,
  policy: Pick<HistoryPartitionPolicy, 'retentionDays' | 'safetyDays'>,
): Date {
  const today = utcDayStart(now);
  return addUtcDays(today, -(policy.retentionDays + policy.safetyDays));
}

export function isHistoryEventRetained(
  occurredAt: string,
  now: Date,
  policy: Pick<HistoryPartitionPolicy, 'retentionDays' | 'safetyDays'>,
): boolean {
  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime())) return false;
  return occurred.getTime() >= historyRetentionCutoffDay(now, policy).getTime();
}

export function historyPartitionWindow(
  now: Date,
  policy: HistoryPartitionPolicy,
): HistoryPartitionWindow {
  const cutoffDay = historyRetentionCutoffDay(now, policy);
  const today = utcDayStart(now);
  const lastFutureDay = addUtcDays(today, policy.precreateDays);
  const days: Date[] = [];
  for (let day = cutoffDay; day.getTime() <= lastFutureDay.getTime(); day = addUtcDays(day, 1)) {
    days.push(day);
  }
  return { cutoffDay, lastFutureDay, days };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function partitionNameForDay(day: Date): string {
  assertWholeDay(day);
  return `${HISTORY_PARTITION_PARENT}_y${day.getUTCFullYear()}m${pad(day.getUTCMonth() + 1)}d${pad(day.getUTCDate())}`;
}

export function parseHistoryPartitionDay(name: string): Date | null {
  const pattern = new RegExp(`^${HISTORY_PARTITION_PARENT}_y(\\d{4})m(\\d{2})d(\\d{2})$`);
  const match = pattern.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function createPartitionSql(day: Date): string {
  const name = partitionNameForDay(day);
  const start = day.toISOString();
  const end = addUtcDays(day, 1).toISOString();
  return [
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(name)}`,
    `PARTITION OF ${quoteIdentifier(HISTORY_PARTITION_PARENT)}`,
    `FOR VALUES FROM ('${start}') TO ('${end}')`,
  ].join(' ');
}

export function dropPartitionSql(name: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdentifier(name)}`;
}

export function planHistoryPartitionMaintenance(
  existingPartitionNames: readonly string[],
  now: Date,
  policy: HistoryPartitionPolicy,
): HistoryPartitionPlan {
  const window = historyPartitionWindow(now, policy);
  const drop: HistoryPartitionPlan['drop'] = [];

  for (const name of existingPartitionNames) {
    const day = parseHistoryPartitionDay(name);
    if (day && day.getTime() < window.cutoffDay.getTime()) {
      drop.push({ day, name, sql: dropPartitionSql(name) });
    }
  }

  drop.sort((a, b) => a.day.getTime() - b.day.getTime());

  return {
    cutoffDay: window.cutoffDay,
    lastFutureDay: window.lastFutureDay,
    create: window.days.map((day) => ({
      day,
      name: partitionNameForDay(day),
      sql: createPartitionSql(day),
    })),
    drop,
  };
}

export function nextDailyMaintenanceDelayMs(now: Date, hourUtc: number, minuteUtc: number): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minuteUtc, 0, 0),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}
