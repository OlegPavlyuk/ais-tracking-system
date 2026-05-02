ALTER TABLE "vessels" ADD COLUMN "sanctions_status" varchar(16);--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "sanctions_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "sanctions_matches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "vessels_sanctions_status_idx" ON "vessels" USING btree ("sanctions_status");
