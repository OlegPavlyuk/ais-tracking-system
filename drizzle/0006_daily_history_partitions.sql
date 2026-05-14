-- Intentionally destructive pre-production migration.
-- The project has no production history data yet, so the old monthly history
-- table is reset to establish the product-aligned daily partition strategy.
-- Do not apply this style of migration to a production system without a data
-- migration/backfill plan.

DROP TABLE IF EXISTS "vessel_positions_history" CASCADE;
--> statement-breakpoint
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
CREATE UNIQUE INDEX IF NOT EXISTS "vessel_positions_history_vessel_occurred_uniq"
	ON "vessel_positions_history" ("vessel_id", "occurred_at");
