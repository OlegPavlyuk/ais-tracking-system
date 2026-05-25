CREATE TABLE IF NOT EXISTS "geo_dataset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"source_metadata" jsonb NOT NULL,
	"coverage_margin_km" double precision NOT NULL,
	"coastal_tolerance_meters" double precision NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_land_polygons" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_layer" text,
	"region" text,
	"geom" geometry(Geometry, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_navigable_water_polygons" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_layer" text,
	"region" text,
	"geom" geometry(Geometry, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_manual_overrides" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_layer" text,
	"region" text,
	"geom" geometry(Geometry, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_land_polygons" ADD CONSTRAINT "geo_land_polygons_dataset_version_id_geo_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."geo_dataset_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_navigable_water_polygons" ADD CONSTRAINT "geo_navigable_water_polygons_dataset_version_id_geo_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."geo_dataset_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_manual_overrides" ADD CONSTRAINT "geo_manual_overrides_dataset_version_id_geo_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."geo_dataset_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "geo_dataset_versions_version_uniq" ON "geo_dataset_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "geo_dataset_versions_single_active_idx" ON "geo_dataset_versions" USING btree ("is_active") WHERE "is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_land_polygons_dataset_version_idx" ON "geo_land_polygons" USING btree ("dataset_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_land_polygons_source_idx" ON "geo_land_polygons" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_land_polygons_geom_gist" ON "geo_land_polygons" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_navigable_water_polygons_dataset_version_idx" ON "geo_navigable_water_polygons" USING btree ("dataset_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_navigable_water_polygons_source_idx" ON "geo_navigable_water_polygons" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_navigable_water_polygons_geom_gist" ON "geo_navigable_water_polygons" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_manual_overrides_dataset_version_idx" ON "geo_manual_overrides" USING btree ("dataset_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_manual_overrides_source_idx" ON "geo_manual_overrides" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_manual_overrides_geom_gist" ON "geo_manual_overrides" USING gist ("geom");--> statement-breakpoint
CREATE OR REPLACE FUNCTION geo_validate_position(lon double precision, lat double precision)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
	active_dataset record;
	point_geom geometry(Point, 4326);
BEGIN
	IF lon IS NULL OR lat IS NULL OR lon < -180 OR lon > 180 OR lat < -90 OR lat > 90 THEN
		RETURN jsonb_build_object(
			'verdict', 'reject',
			'reason', 'invalid_coordinates',
			'datasetVersion', NULL
		);
	END IF;

	SELECT id, version, coastal_tolerance_meters
	INTO active_dataset
	FROM geo_dataset_versions
	WHERE is_active
	ORDER BY activated_at DESC NULLS LAST, created_at DESC
	LIMIT 1;

	IF active_dataset.id IS NULL THEN
		RETURN jsonb_build_object(
			'verdict', 'allow',
			'reason', 'dataset_unavailable',
			'datasetVersion', NULL
		);
	END IF;

	point_geom := ST_SetSRID(ST_MakePoint(lon, lat), 4326);

	IF EXISTS (
		SELECT 1
		FROM geo_manual_overrides o
		WHERE o.dataset_version_id = active_dataset.id
			AND o.geom && point_geom
			AND ST_Covers(o.geom, point_geom)
	) THEN
		RETURN jsonb_build_object(
			'verdict', 'allow',
			'reason', 'manual_allow',
			'datasetVersion', active_dataset.version
		);
	END IF;

	IF EXISTS (
		SELECT 1
		FROM geo_navigable_water_polygons w
		WHERE w.dataset_version_id = active_dataset.id
			AND w.geom && point_geom
			AND ST_Covers(w.geom, point_geom)
	) THEN
		RETURN jsonb_build_object(
			'verdict', 'allow',
			'reason', 'navigable_water',
			'datasetVersion', active_dataset.version
		);
	END IF;

	IF EXISTS (
		SELECT 1
		FROM geo_land_polygons l
		WHERE l.dataset_version_id = active_dataset.id
			AND l.geom && ST_Expand(point_geom, active_dataset.coastal_tolerance_meters / 111320.0)
			AND ST_DWithin(
				ST_Boundary(l.geom)::geography,
				point_geom::geography,
				active_dataset.coastal_tolerance_meters
			)
	) THEN
		RETURN jsonb_build_object(
			'verdict', 'uncertain',
			'reason', 'coastal_tolerance',
			'datasetVersion', active_dataset.version
		);
	END IF;

	IF EXISTS (
		SELECT 1
		FROM geo_land_polygons l
		WHERE l.dataset_version_id = active_dataset.id
			AND l.geom && point_geom
			AND ST_Covers(l.geom, point_geom)
	) THEN
		RETURN jsonb_build_object(
			'verdict', 'reject',
			'reason', 'deep_land',
			'datasetVersion', active_dataset.version
		);
	END IF;

	RETURN jsonb_build_object(
		'verdict', 'allow',
		'reason', 'not_land',
		'datasetVersion', active_dataset.version
	);
END;
$$;
