CREATE TABLE "sanctioned_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(32) NOT NULL,
	"source_entity_id" varchar(64) NOT NULL,
	"name" varchar(512) NOT NULL,
	"imo" varchar(16),
	"mmsi" varchar(9),
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"flag" varchar(128),
	"listing_date" date,
	"programs" text[] DEFAULT '{}' NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions_import_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" varchar(32) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"records_imported" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sanctioned_entities_source_entity_uniq" ON "sanctioned_entities" USING btree ("source","source_entity_id");--> statement-breakpoint
CREATE INDEX "sanctioned_entities_imo_idx" ON "sanctioned_entities" USING btree ("imo");--> statement-breakpoint
CREATE INDEX "sanctioned_entities_mmsi_idx" ON "sanctioned_entities" USING btree ("mmsi");--> statement-breakpoint
CREATE INDEX "sanctioned_entities_name_idx" ON "sanctioned_entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sanctioned_entities_aliases_gin" ON "sanctioned_entities" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "sanctions_import_runs_source_started_idx" ON "sanctions_import_runs" USING btree ("source","started_at");