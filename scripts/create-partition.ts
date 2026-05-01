import 'dotenv/config';
import postgres from 'postgres';

function parseMonth(arg: string | undefined): { year: number; month: number } {
  if (!arg || !/^\d{4}-(0[1-9]|1[0-2])$/.test(arg)) {
    throw new Error(`expected YYYY-MM, got ${arg ?? '<missing>'}`);
  }
  const [y, m] = arg.split('-');
  return { year: Number(y), month: Number(m) };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => a !== '--');
  const { year, month } = parseMonth(arg);
  const startIso = `${year}-${pad(month)}-01T00:00:00.000Z`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endIso = `${nextYear}-${pad(nextMonth)}-01T00:00:00.000Z`;
  const partition = `vessel_positions_history_y${year}m${pad(month)}`;
  const url = process.env.DATABASE_URL ?? 'postgres://ais:ais@localhost:5432/ais';
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "${partition}"
        PARTITION OF vessel_positions_history
        FOR VALUES FROM ('${startIso}') TO ('${endIso}');
      CREATE INDEX IF NOT EXISTS "${partition}_position_gist"
        ON "${partition}" USING gist (position);
      CREATE INDEX IF NOT EXISTS "${partition}_occurred_at_idx"
        ON "${partition}" (occurred_at);
    `);
    console.log(`created partition ${partition} for [${startIso}, ${endIso})`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
