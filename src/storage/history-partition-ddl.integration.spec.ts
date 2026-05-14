import postgres from 'postgres';
import {
  createPartitionSql,
  dropPartitionSql,
  HISTORY_PARTITION_PARENT,
  historyPartitionWindow,
  partitionNameForDay,
  parseHistoryPartitionDay,
} from './history-partitions';

const describeIfDb = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;

function assertDestructiveDbTestAllowed(databaseUrl: string): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'Destructive DB integration tests require NODE_ENV=test. ' +
        'Run only against a disposable local/test database.',
    );
  }

  if (process.env.ALLOW_DESTRUCTIVE_DB_TESTS !== '1') {
    throw new Error(
      'Destructive DB integration tests require ALLOW_DESTRUCTIVE_DB_TESTS=1. ' +
        `This suite recreates ${HISTORY_PARTITION_PARENT} and must never target a valuable database.`,
    );
  }

  const { pathname } = new URL(databaseUrl);
  if (!pathname || pathname === '/') {
    throw new Error('DATABASE_URL must include an explicit disposable database name.');
  }
  if (!pathname.toLowerCase().includes('test')) {
    throw new Error(
      `Destructive DB integration tests require a test-named database, got "${pathname}".`,
    );
  }
}

describeIfDb('history partition DDL integration', () => {
  const url = process.env.DATABASE_URL ?? 'postgres://ais:ais@localhost:5432/ais';
  const sql = postgres(url, { max: 1, onnotice: () => undefined });

  beforeAll(() => {
    assertDestructiveDbTestAllowed(url);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  // Destructive by design: this suite validates generated partition DDL against
  // real Postgres/PostGIS and must only run on a disposable local/test database.
  it('creates daily partitions, inserts across partitions, and drops expired partitions', async () => {
    await sql.unsafe(`
      DROP TABLE IF EXISTS vessel_positions_history CASCADE;
      CREATE EXTENSION IF NOT EXISTS postgis;
      CREATE TABLE vessel_positions_history (
        vessel_id uuid NOT NULL,
        mmsi varchar(9) NOT NULL,
        position geometry(Point, 4326) NOT NULL,
        sog double precision,
        cog double precision,
        true_heading smallint,
        nav_status smallint,
        rate_of_turn double precision,
        occurred_at timestamp with time zone NOT NULL
      ) PARTITION BY RANGE (occurred_at);
      CREATE UNIQUE INDEX vessel_positions_history_vessel_occurred_uniq
        ON vessel_positions_history (vessel_id, occurred_at);
    `);

    const window = historyPartitionWindow(new Date('2026-05-14T12:00:00.000Z'), {
      retentionDays: 7,
      safetyDays: 1,
      precreateDays: 7,
    });
    for (const day of window.days) {
      await sql.unsafe(createPartitionSql(day));
    }

    const expectedPartitionNames = window.days.map(partitionNameForDay);
    const attachedPartitions = await sql<{ relname: string }[]>`
      SELECT child.relname
      FROM pg_inherits
      JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
      JOIN pg_class child ON child.oid = pg_inherits.inhrelid
      WHERE parent.relname = ${HISTORY_PARTITION_PARENT}
        AND child.relname IN ${sql(expectedPartitionNames)}
      ORDER BY child.relname
    `;
    expect(attachedPartitions.map((row) => row.relname)).toEqual(
      [...expectedPartitionNames].sort(),
    );

    const vesselId = '11111111-2222-4333-8444-555555555555';
    await sql`
      INSERT INTO vessel_positions_history (
        vessel_id, mmsi, position, occurred_at
      ) VALUES
        (${vesselId}, '241935000', ST_SetSRID(ST_MakePoint(30, 40), 4326), ${'2026-05-13T12:00:00.000Z'}),
        (${vesselId}, '241935000', ST_SetSRID(ST_MakePoint(31, 41), 4326), ${'2026-05-14T12:00:00.000Z'})
    `;

    const track = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM vessel_positions_history
      WHERE vessel_id = ${vesselId}
        AND occurred_at >= ${'2026-05-13T00:00:00.000Z'}
        AND occurred_at < ${'2026-05-15T00:00:00.000Z'}
    `;
    expect(track[0]?.count).toBe(2);

    await expect(sql`
      INSERT INTO vessel_positions_history (
        vessel_id, mmsi, position, occurred_at
      ) VALUES (
        ${vesselId},
        '241935000',
        ST_SetSRID(ST_MakePoint(29, 39), 4326),
        ${'2026-06-01T12:00:00.000Z'}
      )
    `).rejects.toThrow(/no partition of relation "vessel_positions_history" found for row/);

    const oldName = 'vessel_positions_history_y2026m05d05';
    await sql.unsafe(createPartitionSql(new Date('2026-05-05T00:00:00.000Z')));
    const oldDay = parseHistoryPartitionDay(oldName);
    expect(oldDay?.toISOString()).toBe('2026-05-05T00:00:00.000Z');
    await sql.unsafe(dropPartitionSql(oldName));

    const remainingOld = await sql<{ relname: string }[]>`
      SELECT relname
      FROM pg_class
      WHERE relname = ${oldName}
    `;
    expect(remainingOld).toHaveLength(0);
  });
});
