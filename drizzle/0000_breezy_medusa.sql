CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vessel_positions_latest" (
	"vessel_id" uuid PRIMARY KEY NOT NULL,
	"mmsi" varchar(9) NOT NULL,
	"position" geometry(Point, 4326) NOT NULL,
	"sog" double precision,
	"cog" double precision,
	"true_heading" smallint,
	"nav_status" smallint,
	"rate_of_turn" double precision,
	"occurred_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vessels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mmsi" varchar(9) NOT NULL,
	"imo" varchar(16),
	"name" varchar(255),
	"call_sign" varchar(32),
	"ship_type" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vessel_positions_latest" ADD CONSTRAINT "vessel_positions_latest_vessel_id_vessels_id_fk" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vessel_positions_latest_position_gist" ON "vessel_positions_latest" USING gist ("position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vessel_positions_latest_last_seen_idx" ON "vessel_positions_latest" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vessel_positions_latest_mmsi_idx" ON "vessel_positions_latest" USING btree ("mmsi");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vessels_mmsi_unique" ON "vessels" USING btree ("mmsi");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vessels_imo_idx" ON "vessels" USING btree ("imo");