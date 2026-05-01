CREATE TABLE IF NOT EXISTS "vessel_positions_history" (
	"vessel_id" uuid NOT NULL,
	"mmsi" varchar(9) NOT NULL,
	"position" geometry(Point, 4326) NOT NULL,
	"sog" double precision,
	"cog" double precision,
	"true_heading" smallint,
	"nav_status" smallint,
	"rate_of_turn" double precision,
	"occurred_at" timestamp with time zone NOT NULL
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
DO $$
DECLARE
	cur_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
	next_start timestamptz := cur_start + interval '1 month';
	following_start timestamptz := cur_start + interval '2 months';
	cur_name text := 'vessel_positions_history_y' || to_char(cur_start AT TIME ZONE 'UTC', 'YYYY') || 'm' || to_char(cur_start AT TIME ZONE 'UTC', 'MM');
	next_name text := 'vessel_positions_history_y' || to_char(next_start AT TIME ZONE 'UTC', 'YYYY') || 'm' || to_char(next_start AT TIME ZONE 'UTC', 'MM');
BEGIN
	EXECUTE format(
		'CREATE TABLE IF NOT EXISTS %I PARTITION OF vessel_positions_history FOR VALUES FROM (%L) TO (%L)',
		cur_name, cur_start, next_start
	);
	EXECUTE format(
		'CREATE INDEX IF NOT EXISTS %I ON %I USING gist (position)',
		cur_name || '_position_gist', cur_name
	);
	EXECUTE format(
		'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (vessel_id, occurred_at)',
		cur_name || '_vessel_occurred_uniq', cur_name
	);
	EXECUTE format(
		'CREATE INDEX IF NOT EXISTS %I ON %I (occurred_at)',
		cur_name || '_occurred_at_idx', cur_name
	);

	EXECUTE format(
		'CREATE TABLE IF NOT EXISTS %I PARTITION OF vessel_positions_history FOR VALUES FROM (%L) TO (%L)',
		next_name, next_start, following_start
	);
	EXECUTE format(
		'CREATE INDEX IF NOT EXISTS %I ON %I USING gist (position)',
		next_name || '_position_gist', next_name
	);
	EXECUTE format(
		'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (vessel_id, occurred_at)',
		next_name || '_vessel_occurred_uniq', next_name
	);
	EXECUTE format(
		'CREATE INDEX IF NOT EXISTS %I ON %I (occurred_at)',
		next_name || '_occurred_at_idx', next_name
	);
END $$;
