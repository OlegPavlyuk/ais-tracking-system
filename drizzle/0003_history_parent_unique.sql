DO $$
DECLARE
	rec record;
BEGIN
	FOR rec IN
		SELECT n.nspname AS schema_name, ic.relname AS index_name
		FROM pg_index i
		JOIN pg_class tc ON tc.oid = i.indrelid
		JOIN pg_class ic ON ic.oid = i.indexrelid
		JOIN pg_namespace n ON n.oid = ic.relnamespace
		WHERE tc.relname LIKE 'vessel_positions_history_y%'
		  AND ic.relname LIKE '%_vessel_occurred_uniq'
	LOOP
		EXECUTE format('DROP INDEX IF EXISTS %I.%I', rec.schema_name, rec.index_name);
	END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vessel_positions_history_vessel_occurred_uniq"
	ON "vessel_positions_history" (vessel_id, occurred_at);
