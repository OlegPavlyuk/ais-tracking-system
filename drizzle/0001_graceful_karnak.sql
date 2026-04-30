ALTER TABLE "vessels" ADD COLUMN "destination" varchar(120);--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "dimension_to_bow" smallint;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "dimension_to_stern" smallint;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "dimension_to_port" smallint;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "dimension_to_starboard" smallint;