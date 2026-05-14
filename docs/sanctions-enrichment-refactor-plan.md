# Sanctions / Enrichment Refactor Plan

This plan turns the sanctions/enrichment review into small, independently
reviewable implementation phases. The order intentionally prioritizes
operational correctness first, then enrichment scalability, then type-safety and
maintenance cleanup.

Unless explicitly stated otherwise, refactors should preserve current matching
semantics and operational behavior while improving internal structure,
lifecycle handling, scalability, or type safety.

## Scope Discipline

- Do not combine multiple phases into one implementation change.
- Keep commits focused and reviewable.
- Avoid opportunistic cleanup unrelated to the current phase.
- Prioritize operational correctness first, scalability second, and
  cleanup/refactor third.
- Preserve existing behavior unless the current phase explicitly changes it.
- If a proposed improvement requires schema redesign or major architectural
  expansion, stop and ask before proceeding.
- If uncertainty exists, ask clarification questions instead of making
  assumptions.
- Avoid side quests. Future phases can capture good ideas without folding them
  into the active change.

## Progress Tracker

Current status:

- [x] Phase 0 — Documentation / plan file creation
- [x] Phase 1 — Remove stale import script
- [x] Phase 2 — Bootstrap sanctions import lifecycle
- [x] Phase 3 — Targeted sanctions lookup for enrichment
- [x] Phase 4 — Raw SQL to Drizzle cleanup where appropriate
- [ ] Optional later phase — Import freshness / status visibility

Current phase:

- Phase 4 is complete. Routine sanctions/enrichment repository reads and simple
  import-run writes now use Drizzle query builder where it improves type
  clarity, while specialized raw SQL remains in place for advisory locks,
  array/json-heavy upserts, and guarded update row-count behavior.

What should be done next:

- After Phase 4 is reviewed and committed, consider the optional later phase:
  import freshness / status visibility.
- Keep the optional phase scoped to operator visibility. Do not redesign import
  scheduling, matching semantics, schemas, or queue architecture without a new
  explicit plan.

Relevant files by phase:

- Phase 0:
  - `docs/sanctions-enrichment-refactor-plan.md`
- Phase 1:
  - `scripts/run-sanctions-import.ts`
  - `README.md`
  - `docs/`
  - `package.json`
- Phase 2:
  - `src/enrichment/sanctions/sanctions-import-command.service.ts`
  - `src/enrichment/sanctions/sanctions.scheduler.ts`
  - `src/enrichment/sanctions/sanctions.repository.ts`
  - `src/enrichment/sanctions/sanctions.module.ts`
  - `src/enrichment/sanctions/sanctions.processor.ts`
  - `src/enrichment/sanctions/source-registry.ts`
  - `src/shared/config/env.schema.ts`
  - `src/enrichment/sanctions/*.spec.ts`
- Phase 3:
  - `src/enrichment/vessel/enrichment.repository.ts`
  - `src/enrichment/vessel/enrichment.processor.ts`
  - `src/enrichment/vessel/matcher.ts`
  - `src/enrichment/vessel/*.spec.ts`
  - `src/storage/schema/index.ts`
- Phase 4:
  - `src/enrichment/sanctions/sanctions.repository.ts`
  - `src/enrichment/vessel/enrichment.repository.ts`
  - `src/storage/schema/index.ts`
  - `src/enrichment/**/*.spec.ts`
- Optional later phase:
  - `src/api/sanctions.controller.ts`
  - `src/admin/sanctions-admin.controller.ts`
  - `src/enrichment/sanctions/sanctions.repository.ts`
  - `README.md`
  - `docs/`

Important notes discovered so far:

- `scripts/run-sanctions-import.ts` is stale and should be deleted, not
  rewritten.
- Bootstrap import lifecycle must be role-aware. Keeping the lifecycle service
  inside the sanctions/enrichment worker module path should naturally limit it
  to `worker` and `all` roles because `api` does not import `EnrichmentModule`.
- Do not add import freshness/status endpoint work during Phase 2.
- Drizzle cleanup should remain separate from the bootstrap lifecycle work.
- Bootstrap jobs use deterministic BullMQ job IDs with completed/failed job
  removal so retained terminal jobs do not permanently block future bootstrap
  enqueue attempts.
- Import execution uses a source-scoped Postgres session advisory lock acquired
  and released on the same reserved `postgres.js` connection: namespace key
  `1934910515`, source key `hashtext(source)`.
- Phase 3 removed the vessel enrichment full-table sanctions scan. Enrichment
  now queries IMO and MMSI candidates first, returns `sanctioned` for identifier
  matches, and skips name fallback when any identifier match exists.
- Phase 3 name fallback is intentionally narrower than the previous full-table
  normalized comparison: it queries only exact DB `name` matches or exact
  `aliases` array containment, then keeps existing matcher normalization over
  that narrow candidate set. No alias schema redesign, fuzzy matching,
  migrations, or normalized name columns were added.
- Phase 4 converted simple import-run, vessel fingerprint, and sanctions
  candidate lookup queries to Drizzle. Raw SQL remains intentionally retained
  for source advisory locks, sanctions entity upsert array/json handling, and
  the enrichment freshness-guarded update because those cases are clearer or
  rely on result metadata.
- If clarification is needed during any phase, ask before implementing silent
  assumptions.

End-of-phase checklist for future agents:

1. Summarize what changed.
2. List checks/tests that were run.
3. Update this progress tracker.
4. Mark the phase as completed.
5. Note the next recommended phase.
6. Commit the completed phase after review/approval.
7. Update the Next Session Prompt if the next phase needs new context.

## Phase 0: Documentation / Plan File Creation

### Purpose / Outcome

Create this planning document so implementation can proceed in focused sessions
without re-litigating scope.

### Why This Phase Is Valuable

The sanctions/enrichment work touches operational startup behavior, BullMQ job
semantics, Postgres import audit state, matching logic, and repository style.
A written phased plan prevents unrelated cleanup from leaking into the first
critical change.

### Files and Modules Likely Involved

- `docs/sanctions-enrichment-refactor-plan.md`

### Context Future Sessions Need

- This phase is documentation-only.
- No production code should change in this phase.

### Proposed Implementation Steps

1. Create the plan file.
2. Capture phase boundaries, scope rules, testing expectations, and acceptance
   criteria.
3. Keep explicit out-of-scope items visible.

### Testing Strategy

- No automated tests required.
- Review the document for clarity and alignment with the requested priorities.

### Risks / Trade-offs

- The plan should be specific enough to guide implementation, but not so rigid
  that it blocks better local decisions discovered while editing.

### Acceptance Criteria

- The plan exists under `docs/`.
- The plan includes phases for stale script removal, bootstrap lifecycle,
  targeted lookup, Drizzle cleanup, and optional later visibility.
- No implementation code is modified.

### Definition of Done

- Documentation update is complete.
- No automated tests are required.
- Progress tracker is updated.
- Phase is ready for focused review.
- No unrelated cleanup is included.

### Implementation Notes

- Initial plan file created.
- Progress tracker and next-session prompt added.
- Scope discipline and execution guardrails added.

## Phase 1: Remove Stale `scripts/run-sanctions-import.ts`

### Purpose / Outcome

Delete `scripts/run-sanctions-import.ts`.

### Why This Phase Is Valuable

The script is stale, bypasses Nest dependency injection, duplicates the
production import path, and no longer matches current constructor dependencies
for the sanctions repository/importer. Removing it reduces confusion and keeps
the portfolio story focused on the real operational path: BullMQ jobs managed
through the Nest application.

### Files and Modules Likely Involved

- `scripts/run-sanctions-import.ts`
- `README.md` or docs only if they reference the script
- `package.json` only if a script entry is later discovered that references it

### Context Future Sessions Need

- The project should not keep or rewrite this script.
- Do not replace it with a new standalone direct-import command.
- Manual import should remain available through the existing admin endpoint and
  shared enqueue service.

### Proposed Implementation Steps

1. Search for references to `run-sanctions-import`.
2. Delete `scripts/run-sanctions-import.ts`.
3. Remove any documentation or package script references if they exist.
4. Run typecheck/lint or the smallest relevant validation.

### Testing Strategy

- Run `pnpm typecheck`.
- Run `pnpm lint` if practical.
- If references were removed from docs/package scripts, verify no stale mentions
  remain with `rg`.

### Risks / Trade-offs

- Removing a script can surprise someone using it locally, but this is desirable
  here because it is not the supported path and is currently misleading.

### Acceptance Criteria

- `scripts/run-sanctions-import.ts` no longer exists.
- No package script or docs reference it.
- Typecheck passes.

### Definition of Done

- Implementation is complete.
- Relevant checks are green.
- `pnpm typecheck` is green.
- Docs are updated if stale references were removed.
- Progress tracker is updated.
- Phase is ready for focused review.
- No unrelated cleanup is included.

### Implementation Notes

- Deleted `scripts/run-sanctions-import.ts`.
- Searched `README.md`, `docs/`, `package.json`, and `scripts/` for
  `run-sanctions-import`; no references remain outside this plan.
- `package.json` did not contain a package script for the stale import script.
- Manual sanctions import remains available through the admin endpoint and
  shared queue path.
- Checks run:
  - `pnpm typecheck`
  - `pnpm lint`

## Phase 2: Bootstrap Sanctions Import Lifecycle

### Purpose / Outcome

Automatically enqueue an initial sanctions import when a worker/all process
starts and no successful import has ever completed for the source.

This should remove the current fresh-start requirement to manually call the
admin endpoint after startup.

### Why This Phase Is Valuable

Operational correctness is the highest-priority improvement. A fresh deployment
should become useful without a manual admin action. The design also makes the
import lifecycle explicit and portfolio-grade: recurring scheduling, manual
enqueue, and bootstrap catch-up become separate but coordinated use cases.

### Files and Modules Likely Involved

- `src/enrichment/sanctions/sanctions-import-command.service.ts`
- `src/enrichment/sanctions/sanctions.scheduler.ts`
- `src/enrichment/sanctions/sanctions.repository.ts`
- `src/enrichment/sanctions/sanctions.module.ts`
- `src/enrichment/sanctions/sanctions.processor.ts`
- `src/enrichment/sanctions/source-registry.ts`
- `src/shared/config/env.schema.ts` only if a new threshold/feature flag is
  needed
- Existing or new specs under `src/enrichment/sanctions/*.spec.ts`

### Context Future Sessions Need

- Role awareness is mostly handled by module composition:
  `EnrichmentModule` is loaded for `worker` and `all`, not `api`.
- The lifecycle service should therefore live inside the sanctions/enrichment
  worker module path, not in `AdminModule` or `ApiModule`.
- Do not add an admin/status endpoint for import freshness in this phase.
- Prefer central enqueueing through `SanctionsImportCommandService`.
- Use deterministic BullMQ job IDs for bootstrap/catch-up jobs.
- Avoid mixing Drizzle repository refactors into this phase unless a tiny helper
  is needed for the lifecycle query.
- Bootstrap import enqueueing should be best-effort and non-blocking.
  Application startup must not fail solely because bootstrap enqueueing failed.
  Failures should be logged clearly with enough source/job context to diagnose.
- Use deterministic BullMQ job IDs for enqueue deduplication.
- Prefer Postgres advisory locks for actual import execution safety.
- Avoid introducing Redis-based distributed lock abstractions unless clearly
  necessary and approved.
- Completed/failed BullMQ job retention policies can accidentally prevent future
  bootstrap jobs from being enqueued if deterministic IDs are reused
  incorrectly. The implementation must account for this and avoid permanent
  bootstrap blockage.

### Proposed Implementation Steps

1. Extend `SanctionsRepository` with a focused method such as
   `findLastSuccessfulRunBySource(source)` or
   `hasSuccessfulRunBySource(source)`.
2. Extend `SanctionsImportCommandService` with explicit methods for import
   intents, for example:
   - `requestManualRun(source)`
   - `requestBootstrapRun(source)`
3. Give bootstrap jobs deterministic job IDs, for example
   `sanctions.import:ofac:bootstrap`.
4. Add a lifecycle service, for example `SanctionsImportLifecycleService`, that
   runs on application bootstrap inside the worker/all sanctions module.
5. In the lifecycle service, for each configured sanctions source:
   - check whether a successful import exists;
   - if none exists, enqueue a bootstrap import through
     `SanctionsImportCommandService`;
   - log whether it enqueued or skipped.
6. Keep recurring schedule registration in `SanctionsScheduler`, or rename/split
   if it clarifies responsibility, but avoid broad module reshaping in this
   phase.
7. Implement duplicate/race protection with this preferred strategy:
   - deterministic BullMQ job IDs for bootstrap enqueue deduplication;
   - Postgres advisory lock around actual import execution so manual,
     bootstrap, and scheduled paths cannot run the same source concurrently;
   - raw SQL is acceptable for advisory locks because they are a database
     primitive;
   - do not add a Redis lock abstraction unless a concrete limitation of the
     preferred approach is discovered and approved.
8. Ensure deterministic job IDs and BullMQ retention settings cannot permanently
   block future bootstrap attempts after completed/failed jobs are retained.
   If needed, use intent-specific job IDs, explicit job-state handling, or
   retention settings that preserve idempotency without creating a permanent
   dead end.
9. Preserve existing admin manual import behavior.

### Testing Strategy

- Unit-test lifecycle decisions:
  - enqueues bootstrap job when no successful run exists;
  - skips when a successful run exists;
  - logs/does not throw in expected skip paths.
- Unit-test command service enqueue options:
  - manual jobs keep current behavior or intentionally updated behavior;
  - bootstrap jobs use deterministic job IDs.
- If an advisory lock is added:
  - unit-test repository/importer behavior around lock acquired vs not acquired;
  - keep integration testing optional unless the repo already has a suitable DB
    test harness.
- Run focused Jest specs for sanctions.
- Run `pnpm typecheck`.

### Risks / Trade-offs

- Deterministic BullMQ job IDs reduce duplicate queued jobs, but do not by
  themselves prevent every concurrent execution scenario.
- A Postgres advisory lock improves safety but introduces raw SQL and another
  operational concept. That is acceptable if scoped tightly and documented in
  code/tests.
- A stale failed bootstrap job with the same deterministic ID could block
  re-enqueue depending on BullMQ retention and job state. The implementation
  should account for failed/completed retention and be tested against the chosen
  behavior.
- Checking only "latest run" is not enough; the decision should care whether
  any successful import exists for the source, or specifically the latest
  successful import.
- Bootstrap enqueue failures should not crash the process. This trades strict
  startup enforcement for service availability and clear logs.

### Acceptance Criteria

- On worker/all startup, if no successful import exists for `ofac`, an import
  job is automatically enqueued.
- API-only role does not run the bootstrap lifecycle service.
- Bootstrap enqueueing is idempotent under repeated startup.
- Bootstrap enqueueing is best-effort and does not fail application startup by
  itself.
- Duplicate import execution is prevented or the remaining duplicate risk is
  explicitly minimized and documented.
- Deterministic job IDs are compatible with BullMQ retention and do not create
  permanent bootstrap blockage.
- Admin manual import behavior still works.
- No admin/status import freshness endpoint is added.
- Focused tests and typecheck pass.

### Definition of Done

- Implementation is complete.
- Focused sanctions tests are green.
- `pnpm typecheck` is green.
- Docs are updated if behavior or operational notes changed.
- Progress tracker is updated.
- Phase is ready for focused review.
- No unrelated cleanup is included.

### Implementation Notes

- Added `SanctionsImportLifecycleService` inside `SanctionsModule`, so the
  bootstrap lifecycle runs through the enrichment worker module path used by
  `worker` and `all` roles. API-only role composition still does not import
  `EnrichmentModule`.
- The lifecycle service checks `hasSuccessfulRunBySource(source)` for each
  configured sanctions source and enqueues a bootstrap job only when no
  successful import run exists.
- Bootstrap enqueueing is fire-and-forget and best-effort:
  repository/queue failures are logged with source context and do not block or
  throw from application bootstrap.
- `SanctionsImportCommandService` now has explicit `requestManualRun()` and
  `requestBootstrapRun()` methods. Existing `requestRun()` remains as a manual
  import compatibility alias so admin behavior is preserved.
- Bootstrap jobs use deterministic IDs in the form
  `sanctions.import:<source>:bootstrap`. They set `removeOnComplete: true` and
  `removeOnFail: true` so the deterministic ID dedupes queued/active bootstrap
  jobs without retained terminal jobs permanently blocking later startup
  attempts.
- Import execution now calls `SanctionsRepository.withSourceImportLock()`.
  The repository uses `pg_try_advisory_lock(1934910515, hashtext(source))` on a
  reserved `postgres.js` connection, releases with `pg_advisory_unlock(...)` in
  `finally`, and skips the import when another process holds the source lock.
- The advisory lock is a distributed mutex only. The OFAC import is not wrapped
  in one long-running database transaction; it keeps the existing ETL flow of
  `startRun`, independent batch upserts, and `finishRun`.
- `SanctionsImporterService` closes the import duration timer in `finally`.
  If marking a failed import run as failed also fails, that secondary failure is
  logged and the original import error is rethrown for BullMQ retry handling.
- Review follow-up simplified the lifecycle bootstrap flow to start one
  fire-and-forget bootstrap check per configured source while keeping
  per-source error handling inside `bootstrapSource()`.
- No admin/status freshness endpoint was added.
- Checks run:
  - `pnpm test -- src/enrichment/sanctions`
  - `pnpm typecheck`
  - `pnpm lint`

## Phase 3: Targeted Sanctions Lookup for Enrichment

### Purpose / Outcome

Replace the current full-table sanctions candidate scan per vessel enrichment
job with targeted lookup methods.

### Why This Phase Is Valuable

`loadAllSanctionCandidates()` is simple but scales poorly. Each vessel job pays
an O(N) cost across all sanctions rows. Targeted lookups align the code with the
database indexes that already exist on `imo`, `mmsi`, and `name`, while keeping
the conservative matching behavior suitable for a sanctions MVP.

### Files and Modules Likely Involved

- `src/enrichment/vessel/enrichment.repository.ts`
- `src/enrichment/vessel/enrichment.processor.ts`
- `src/enrichment/vessel/matcher.ts`
- `src/enrichment/vessel/*.spec.ts`
- Possibly `src/storage/schema/index.ts` only if existing schema exports are
  needed, but no migrations should be added in this phase.

### Context Future Sessions Need

- Do not add normalized alias tables in this phase.
- Do not add fuzzy matching.
- Do not over-engineer name matching.
- Do not perform full in-memory scans across all sanctions entities during
  enrichment matching.
- If no useful name exists, returning no name candidates is acceptable.
- Preserve current semantics:
  - exact IMO and MMSI matches produce `sanctioned`;
  - name-only matches produce `candidate`;
  - if identifier matches exist, name candidates should not be surfaced.

### Proposed Implementation Steps

1. Introduce repository methods such as:
   - `findSanctionCandidatesByImo(imo)`
   - `findSanctionCandidatesByMmsi(mmsi)`
   - `findSanctionCandidatesByName(name)`
2. Implement IMO and MMSI lookups using indexed equality filters.
3. Implement basic name fallback using current conservative behavior as closely
   as practical:
   - exact DB `name` equality may be acceptable as a first step;
   - application-side normalization can be used only over a narrow candidate set;
   - do not load or scan the full sanctions table in memory for aliases or
     normalized names.
4. Refactor matching orchestration so the processor/repository loads only the
   candidates needed for the available vessel fingerprint.
5. Keep or adapt pure matcher tests so match ordering, deduplication, and status
   semantics remain clear.
6. Deprecate/remove `loadAllSanctionCandidates()` once callers are migrated.

### Testing Strategy

- Unit-test repository query generation or behavior for:
  - IMO lookup;
  - MMSI lookup;
  - name fallback lookup.
- Unit-test processor orchestration:
  - identifier match skips name fallback;
  - no identifier match attempts name fallback;
  - no useful name produces clear/no candidates.
- Preserve existing matcher tests where possible.
- Run focused enrichment tests and `pnpm typecheck`.

### Risks / Trade-offs

- Exact DB name lookup without normalized columns may miss matches that current
  full-table normalized comparison would find.
- Keeping alias matching without a normalized alias structure is awkward. It is
  acceptable to make name fallback narrower for now if the behavior is
  documented and tests reflect it; it is not acceptable to preserve recall by
  hiding a full-table in-memory scan.
- A future migration for normalized names/aliases would improve recall, but that
  is intentionally out of scope for this phase.

### Acceptance Criteria

- Per-vessel enrichment no longer loads every sanctions entity.
- Enrichment matching performs no hidden full-table in-memory scans.
- Exact IMO and MMSI matching continue to work.
- Name fallback remains conservative and does not require fuzzy matching or new
  migrations.
- Current status semantics are preserved.
- Focused tests and typecheck pass.

### Definition of Done

- Implementation is complete.
- Focused enrichment tests are green.
- `pnpm typecheck` is green.
- Docs are updated if matching limitations or behavior changed.
- Progress tracker is updated.
- Phase is ready for focused review.
- No unrelated cleanup is included.

### Implementation Notes

- Added targeted repository methods:
  `findSanctionCandidatesByImo(imo)`,
  `findSanctionCandidatesByMmsi(mmsi)`, and
  `findSanctionCandidatesByName(name)`.
- Removed the `loadAllSanctionCandidates()` repository method after migrating
  the processor, so vessel enrichment no longer has a full-table candidate scan
  path.
- `EnrichmentProcessor` now queries identifier candidates first and runs the
  existing pure matcher over only those candidates. If the matcher returns
  `sanctioned`, name fallback is skipped so identifier matches continue to
  suppress name-only candidates.
- If identifier lookups produce no sanctions match, the processor performs name
  fallback only when the vessel has a useful normalized name.
- Name fallback is deliberately conservative in this phase. The repository uses
  exact `name = $1` or exact `aliases @> ARRAY[$1]::text[]` lookup and does not
  attempt fuzzy matching, full-table normalization, generated columns,
  migrations, or alias-table redesign.
- Existing matcher behavior remains unchanged for a supplied candidate set:
  exact IMO/MMSI matches produce `sanctioned`, name/alias matches produce
  `candidate`, duplicate entity matches are deduped, and display fields remain
  in match payloads.
- Checks run:
  - `pnpm test -- src/enrichment/vessel`
  - `pnpm typecheck`

## Phase 4: Raw SQL to Drizzle Cleanup Where Appropriate

### Purpose / Outcome

Replace routine raw SQL with Drizzle Query Builder where it clearly improves
type safety, readability, and maintainability.

### Why This Phase Is Valuable

Several repositories currently use raw SQL plus manual casts from
`Record<string, unknown>`. This weakens TypeScript and makes routine CRUD noisier
than necessary. Moving simple queries to Drizzle makes the project read more
like a modern TypeScript backend while preserving raw SQL for operations where
it remains the better tool.

### Files and Modules Likely Involved

- `src/enrichment/sanctions/sanctions.repository.ts`
- `src/enrichment/vessel/enrichment.repository.ts`
- `src/storage/schema/index.ts`
- Tests under `src/enrichment/**`
- Possibly other repositories in later follow-up, but this phase should stay
  sanctions/enrichment-focused.

### Context Future Sessions Need

- Do not mix this cleanup into Phase 2 bootstrap lifecycle work.
- Prefer Drizzle for routine CRUD and simple selects/updates.
- Keep raw SQL where it remains clearer or technically appropriate:
  - PostGIS;
  - partition DDL;
  - advisory locks;
  - complex bulk operations;
  - complex JSON/array operations;
  - cases where Drizzle makes code harder to read.

### Proposed Implementation Steps

1. Convert simple sanctions import run queries to Drizzle:
   - start run;
   - finish run;
   - recent runs;
   - last successful/latest run queries.
2. Convert simple vessel fingerprint and sanctions candidate lookup queries to
   Drizzle if not already done in Phase 3.
3. Evaluate `upsertEntities` separately:
   - use Drizzle bulk insert with `onConflictDoUpdate` if it is cleaner;
   - keep raw SQL if array/json handling becomes less readable.
4. Evaluate `applyEnrichment` separately:
   - use Drizzle if the freshness guard and row-count behavior remain clear;
   - keep raw SQL if result metadata is easier to reason about.
5. Remove unnecessary casts and duplicate row-mapping helpers.
6. Keep tests focused on behavior and important query semantics, not brittle SQL
   snapshots unless no better option exists.

### Testing Strategy

- Run existing sanctions/enrichment unit tests.
- Add/adjust repository tests to cover typed mapping and null/date handling.
- Run `pnpm typecheck`.
- Run `pnpm lint` if practical.

### Risks / Trade-offs

- Drizzle can make simple CRUD safer, but can make specialized SQL harder to
  read. The goal is not to eliminate all raw SQL.
- Some existing tests inspect raw SQL strings. Those tests may need to become
  behavior-oriented or Drizzle-aware.
- Bulk upsert conversion must preserve current idempotency and metrics behavior.

### Acceptance Criteria

- Routine sanctions/enrichment CRUD uses Drizzle where it improves clarity.
- Raw SQL remains for justified cases.
- Manual `unknown` row casts are meaningfully reduced.
- Behavior is unchanged.
- Focused tests and typecheck pass.

### Definition of Done

- Implementation is complete.
- Focused sanctions/enrichment tests are green.
- `pnpm typecheck` is green.
- Docs are updated if repository conventions changed.
- Progress tracker is updated.
- Phase is ready for focused review.
- No unrelated cleanup is included.

### Implementation Notes

- Converted `SanctionsRepository.startRun()`, `finishRun()`,
  `findRecentRuns()`, `findLastRunBySource()`, and
  `hasSuccessfulRunBySource()` to Drizzle query builder.
- Added a shared `mapImportRun()` helper for sanctions import run rows so
  date-to-ISO and JSON error mapping are centralized instead of repeated across
  recent/latest queries.
- Converted `EnrichmentRepository.findVesselFingerprintByMmsi()` and targeted
  sanctions candidate lookups to Drizzle query builder.
- Kept the Phase 3 name fallback semantics unchanged: exact `name` equality or
  exact `aliases @> ARRAY[...]::text[]` containment only.
- Raw SQL intentionally retained:
  - `SanctionsRepository.withSourceImportLock()` because the reserved
    `postgres.js` connection and advisory lock acquire/release pairing are the
    important behavior.
  - `SanctionsRepository.upsertEntities()` because the current batch loop uses
    JSON-to-text-array conversion and JSONB payload writes that are clearer in
    SQL for now.
  - `EnrichmentRepository.applyEnrichment()` because the freshness guard and
    `rowCount`/result metadata handling are easier to reason about as raw SQL.
- Tests now cover Drizzle-backed mapping for import runs, vessel fingerprints,
  sanctions candidate null/date handling, and existing advisory lock behavior.
- Checks run:
  - `pnpm test -- src/enrichment`
  - `pnpm typecheck`
  - `pnpm lint`

## Optional Later Phase: Import Freshness / Status Visibility

### Purpose / Outcome

Expose clearer sanctions import freshness and lifecycle status to operators.

### Why This Phase Is Valuable

After bootstrap import exists, visibility can help answer operational questions:
when imports last succeeded, whether a source is stale, and whether the system
is relying on old sanctions data.

### Files and Modules Likely Involved

- `src/api/sanctions.controller.ts`
- `src/admin/sanctions-admin.controller.ts`
- `src/enrichment/sanctions/sanctions.repository.ts`
- `README.md` / architecture docs
- Frontend only if UI visibility is later desired

### Context Future Sessions Need

- This is explicitly out of scope for the bootstrap lifecycle change.
- Do not add this endpoint/status work in Phase 2.

### Possible Implementation Ideas

1. Add last successful import metadata to existing source response.
2. Add `isStale` based on a configured freshness threshold.
3. Optionally expose queued/running import state if BullMQ visibility is needed.
4. Document how operators interpret the freshness fields.

### Testing Strategy

- Controller tests for response shape.
- Repository tests for last successful/latest attempted import queries.

### Risks / Trade-offs

- More status fields can imply stronger guarantees than the system provides.
  Naming should distinguish "last attempted" from "last successful".

### Acceptance Criteria

- Operators can see meaningful import freshness without reading database rows.
- The response distinguishes successful imports from failed attempts.
- The behavior is documented.

### Definition of Done

- Implementation is complete.
- Relevant API/admin tests are green.
- `pnpm typecheck` is green.
- Docs are updated if response shape or operational behavior changed.
- Progress tracker is updated.
- Phase is ready for focused review.
- No unrelated cleanup is included.

### Implementation Notes

- Capture important discoveries, rejected alternatives, edge cases,
  operational caveats, or architectural findings here during implementation.

## Next Session Prompt

Use this prompt for a future AI-agent session starting from a fresh context
window:

```text
You are working in the AIS Tracking System repository. First, read
docs/sanctions-enrichment-refactor-plan.md completely. Check the Progress
Tracker near the top of the file and start from the next incomplete phase.

Review the files listed for that phase before making recommendations or edits.
Implement only the current approved phase; do not bundle later phases or nearby
cleanup into the same change. Do not create large multi-phase commits. Preserve
existing operational behavior and matching semantics unless the current phase
explicitly changes them. Avoid side quests and unrelated cleanup.

Do not invent requirements or silently implement assumptions. If anything is
ambiguous, ask concise clarification questions before changing code. If a
possible improvement requires schema redesign, new infrastructure, or major
architectural expansion, stop and ask before proceeding.

After implementing the current phase, run the relevant checks/tests listed in
the phase plan. Then update docs/sanctions-enrichment-refactor-plan.md:
summarize what changed, list checks/tests run, mark the phase as completed in
the Progress Tracker, note important implementation findings, and identify the
next recommended phase. If the next phase requires new context or constraints,
update this Next Session Prompt.

After review/approval, commit the completed phase as its own focused commit.
Each completed phase should become one focused commit after review/approval,
not a combined multi-phase commit.
```
