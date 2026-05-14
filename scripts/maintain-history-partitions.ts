import 'dotenv/config';
import postgres from 'postgres';
import {
  HISTORY_PARTITION_LOCK_ID,
  HISTORY_RETENTION_SAFETY_DAYS,
  planHistoryPartitionMaintenance,
} from '../src/storage/history-partitions';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const policy = {
    retentionDays: intEnv('HISTORY_RETENTION_DAYS', 7),
    safetyDays: HISTORY_RETENTION_SAFETY_DAYS,
    precreateDays: intEnv('HISTORY_PRECREATE_DAYS', 7),
  };
  const url = process.env.DATABASE_URL ?? 'postgres://ais:ais@localhost:5432/ais';
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      const lock = await tx<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${HISTORY_PARTITION_LOCK_ID}) AS acquired
      `;
      if (!lock[0]?.acquired) {
        console.log('history partition maintenance skipped: advisory lock is held');
        return;
      }

      const partitions = await tx<{ name: string }[]>`
        SELECT child.relname AS name
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        JOIN pg_namespace ns ON child.relnamespace = ns.oid
        WHERE parent.relname = 'vessel_positions_history'
          AND ns.nspname = 'public'
      `;

      const plan = planHistoryPartitionMaintenance(
        partitions.map((partition) => partition.name),
        new Date(),
        policy,
      );

      for (const partition of plan.create) {
        await tx.unsafe(partition.sql);
      }
      for (const partition of plan.drop) {
        await tx.unsafe(partition.sql);
      }

      console.log(
        [
          'history partition maintenance complete',
          `created_or_verified=${plan.create.length}`,
          `dropped=${plan.drop.length}`,
          `retained_from=${plan.cutoffDay.toISOString()}`,
          `precreated_through=${plan.lastFutureDay.toISOString()}`,
        ].join(' '),
      );
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
