# Slice #13 — Frontend (map + REST snapshot + WS updates)

Single source of truth for Slice #13. Captures every locked decision from the
HITL grilling session and the execution plan to follow. Read this before
starting implementation; do not re-litigate locked decisions without explicit
approval.

## Executive Summary

Greenfield React + MapLibre frontend that renders AIS vessels in the current
viewport. On mount it fits the configured supported coverage area, opens one
WebSocket to `/ws/positions`, sends `subscribe`, and fires a REST snapshot to
`GET /api/vessels?bbox=...` in parallel. Live `position` and `static` events
update an mmsi-keyed Zustand store, which feeds a single MapLibre GeoJSON
source + symbol layer (rAF/100ms-batched `setData`). Viewport changes (debounced
300ms) always send `update_subscription`; REST snapshot fires only on
significant change. Reconnect uses exponential backoff with jitter mirroring
the backend AISStream adapter. The supported coverage bbox is rendered as a
subtle outline; `BBOX_OUT_OF_SCOPE` surfaces as a non-modal banner. Detail
panel, sanctions badges, and track viz are explicitly out of scope (slices
#14 / #15).

The frontend lives in a new sibling `web/` directory with its own
`package.json` (no workspace), shares contract types with the backend via
Vite aliases (`@contracts`, `@protocol`), and is served in dev via a Vite
proxy to the existing Docker backend on `:3000` (no backend CORS work).

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Project layout | Sibling `web/` with own `package.json`. No pnpm workspace. SPA NOT served by Nest. Optional root `web:dev` / `web:build` convenience scripts allowed. |
| 2 | TypeScript strictness | `strict: true` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`. |
| 3 | Shared contracts | Vite aliases `@contracts` -> `../src/contracts`, `@protocol` -> `../src/realtime/protocol`. Backend files must stay frontend-safe (no Nest / Node-only / DB / Redis imports). Verified clean today (Zod + pure TS constants only). Promote to `packages/contracts` later if boundary breaks. |
| 4 | State management | Zustand. Single store: `vessels: Map<mmsi, Vessel>`, `bbox`, `wsStatus`, `error`. Map mutations done via immutable replacement (or version counter). No Context/useReducer for live updates. |
| 5 | Vessel keying | Key by `mmsi`. `vesselId` denormalized on each record, populated from REST snapshot and `vessel.enriched`. Slice #14 falls back to mmsi-only minimal panel when `vesselId` is not yet known. |
| 6 | Data fetching | Plain `fetch` + `AbortController` inside Zustand actions. Thin `apiClient` layer (`web/src/api/`) so swap is local. No TanStack Query for live map state. TanStack Query reserved for future request-response screens (#14 detail, #15 track, admin). |
| 7 | Styling | Tailwind CSS, configured for Vite. |
| 8 | Map tile source | OpenFreeMap `liberty` style (`https://tiles.openfreemap.org/styles/liberty`). Configurable via `VITE_MAP_STYLE_URL`; fallback to MapLibre demotiles when unset. |
| 9 | Marker rendering | Single GeoJSON source + symbol layer for all vessels. `icon-rotate` from `cog` (fallback `trueHeading`). `icon-allow-overlap: true`. WS updates batched via rAF/100ms cap before `source.setData(buildFC(store))`. No DOM markers for the live set. Stable layer id `vessels`. |
| 10 | Marker icon | Inline SVG rasterized via `map.addImage('vessel-default', ...)` at map `load`. 24x24 north-pointing arrow. Single neutral icon for #13. Registry pattern leaves room for `vessel-sanctioned` / `vessel-selected` in #14. No icon dependency. |
| 11 | Snapshot <-> WS merge | Timestamp-guarded per-vessel merge. On snapshot: build `nextVessels` from rows; merge into existing entries only when snapshot `last_seen_at` >= stored `occurredAt`; merge profile fields without overwriting non-null with null/undefined; vessels not in snapshot are dropped. On WS `position`: upsert by mmsi only when `event.occurredAt >= stored.occurredAt`. On WS `static`: upsert profile by mmsi; create stub if mmsi unknown. Request guard: monotonic `requestId` + `AbortController`; ignore stale responses that do not match the latest request. |
| 12a | Significance threshold | WS `update_subscription` fires on every debounced bbox change. REST snapshot fires only when zoom changed, OR new bbox is not contained in prior fetched bbox, OR area ratio is < 0.75 or > 1.33. |
| 12b | Debounce | 300ms trailing debounce on the bbox-change signal; one debounce drives both WS `update_subscription` and the REST significance check. |
| 13a | WS backoff | Exponential 1s -> 2s -> 4s -> 8s -> 16s, capped at 30s, +/-20% jitter. Attempt counter resets only after the first valid server message post-open (mirrors backend AISStream adapter). |
| 13b | Reconnect resync | Always resend `subscribe(currentBbox)` on reopen. Additionally fire a REST snapshot only if `Date.now() - disconnectedAt > 5000` ms. Track `disconnectedAt` on socket close. |
| 14 | Error UX (BBOX_OUT_OF_SCOPE) | Generic, NOT Black-Sea-hardcoded. Render the supported coverage bbox as a subtle outline rectangle on the map at all times. On error, show non-modal banner: "Outside supported coverage area." Boundary sourced from `details.supportedBbox` when present; fallback to `VITE_SUPPORTED_BBOX`. No "Black Sea" string baked into components. No modal overlay or recenter button in #13. |
| 15 | Initial camera | On map `load`, `map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, duration: 0 })` using configured supported bbox. First WS `subscribe` and REST snapshot use post-fit `map.getBounds()`. |
| 16 | Click affordance | None in #13. Slice #14 will add `map.on('click', 'vessels', ...)`. Only seam left is the stable layer id `vessels`. No speculative `selectedMmsi` state. |
| 17 | Connection status | Fixed top-right pill: green "Live" / yellow "Reconnecting..." / red "Disconnected". No vessel count. |
| 18 | Dev workflow | Vite dev server proxies `/api/*` and `/ws/*` (with `ws: true`) to `http://localhost:3000` (verified backend port). Frontend code uses relative URLs; WS URL built from current page origin/protocol (`ws` for `http`, `wss` for `https`). No backend CORS work in this slice. |
| 19 | Testing | Vitest + jsdom + `@testing-library/react`. Three test files: bbox-debounce hook (fake timers), merge reducer (timestamp-guarded rules), backoff fn (series + jitter bounds + cap). No e2e. |
| 20 | Lint / format | Vite-scaffolded ESLint flat config in `web/`, independent from backend. Prettier matches root style. Scripts: `dev`, `build`, `preview`, `lint`, `format`, `format:check`, `typecheck`, `test`. |
| 21 | WS message validation | Build `ServerMessageSchema = z.discriminatedUnion('type', [...])` from existing schemas in `@contracts`. Every inbound frame: `JSON.parse` -> Zod `safeParse` -> on failure log + drop, do not crash. |
| 22 | Staleness pruning | None on the client in #13. Vessels age out via the next valid REST snapshot for the current viewport, or page reload. Backend already filters by `staleMinutes` in `GET /api/vessels`. |
| 23 | Bootstrap ordering | Map `load` -> `fitBounds` -> in parallel: open WS + `subscribe(bbox)` AND fire REST snapshot. Q11 merge rules are the single consistency mechanism. WS events arriving before snapshot stub-insert; snapshot then merges with timestamp guard. No special bootstrapping mode. |
| 24 | Runtime versions | `web/package.json` mirrors backend: `engines.node >=22`, `packageManager: pnpm@10.27.0`. |

## Implementation Plan

### Phase 1 — Scaffold (`web/`)

- [x] 1.1 Create `web/` with Vite React-TS scaffold (hand-write or `pnpm create vite`); set `engines.node >=22` and `packageManager: pnpm@10.27.0`.
- [x] 1.2 `tsconfig.json`: enable Q2 strictness flags.
- [x] 1.3 `vite.config.ts`: aliases (`@contracts` -> `../src/contracts`, `@protocol` -> `../src/realtime/protocol`, `@/` -> `./src`); proxy `/api` and `/ws` (with `ws: true`) -> `http://localhost:3000`.
- [x] 1.4 Tailwind setup (config + PostCSS + `index.css` directives). Stable Vite-friendly setup; do not fight tooling.
- [x] 1.5 Install runtime deps: `maplibre-gl`, `zustand`, `zod`, `clsx`. Dev deps: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@types/node`.
- [x] 1.6 Optional root `web:dev` / `web:build` convenience scripts in repo `package.json`. Do NOT disrupt existing backend scripts or Docker flow.
- [x] 1.7 Verify Vite build does not pull backend Nest/Node imports through `@contracts` / `@protocol`. If it does, STOP and report. (verified: contracts/protocol/constants are Zod + pure TS only)

### Phase 2 — Core building blocks (no map yet)

- [x] 2.1 `web/src/lib/protocol.ts`: build `ServerMessageSchema` discriminated union from `@contracts`.
- [x] 2.2 `web/src/lib/coverageBbox.ts`: parse `VITE_SUPPORTED_BBOX` (`minLon,minLat,maxLon,maxLat`) with a sane fallback.
- [x] 2.3 `web/src/store/mergeReducer.ts`: pure timestamp-guarded merge functions (testable in isolation).
- [x] 2.4 `web/src/store/vessels.ts`: Zustand store with state + actions (`applySnapshot`, `applyPosition`, `applyStatic`, `applyEnriched`, `setStatus`, `setError`).
- [x] 2.5 `web/src/api/client.ts`: `fetchSnapshot(bbox, signal)`; throws typed `ApiError` carrying `{ code, message, details }`.
- [x] 2.6 `web/src/lib/backoff.ts`: pure `nextBackoffMs(attempt)` mirroring backend curve + jitter + cap.
- [x] 2.7 `web/src/hooks/useDebouncedBbox.ts`: 300ms trailing debounce.
- [x] 2.8 `web/src/lib/wsClient.ts`: WS wrapper - URL built from `window.location` (ws/wss); subscribe; update_subscription; Zod-validate inbound; reconnect with backoff; track `disconnectedAt`; onResync callback when outage > 5s.

### Phase 3 — Map + integration

- [x] 3.1 `web/src/map/MapView.tsx`: MapLibre init from `VITE_MAP_STYLE_URL`; `fitBounds(supportedBbox, { padding: 40, duration: 0 })`; register `vessel-default` icon (inline SVG); add `vessels` GeoJSON source + symbol layer; add coverage-area outline layer.
- [x] 3.2 `web/src/map/useVesselsLayer.ts`: subscribe to store; rAF/100ms-batched `source.setData(buildFC(vessels))`.
- [x] 3.3 `web/src/map/useViewportSync.ts`: `moveend`/`zoomend` -> debounced bbox -> WS `update_subscription` + REST significance check.
- [x] 3.4 `web/src/App.tsx`: orchestrate Q23 bootstrap (after map `load`: open WS + subscribe AND fire REST snapshot in parallel).
- [x] 3.5 `web/src/components/StatusPill.tsx`: connection indicator.
- [x] 3.6 `web/src/components/CoverageBanner.tsx`: non-modal banner driven by `error.code === 'BBOX_OUT_OF_SCOPE'`.

### Phase 4 — Tests

- [x] 4.1 `mergeReducer.spec.ts`: snapshot-with-newer-WS-position; static-stub-insert; snapshot drops out-of-result; profile non-null merge.
- [x] 4.2 `useDebouncedBbox.spec.ts`: fake timers, trailing semantics.
- [x] 4.3 `backoff.spec.ts`: series + jitter bounds + cap.

### Phase 5 — Wrap-up

- [x] 5.1 Manual acceptance check against `docs/issues.md` slice #13 criteria.
- [x] 5.2 `pnpm lint`, `pnpm typecheck`, `pnpm test` green in `web/`.
- [x] 5.3 Smoke test against running Docker backend.
- [x] 5.4 Commit: `feat: frontend map + REST snapshot + WS updates (slice #13)`.

### Out of scope (held the line)

- Click handler / detail panel -> #14
- Track polyline -> #15
- Sanctions color coding / badges -> #14
- Vessel count, last-viewed persistence, recenter button, e2e tests, backend CORS, workspace refactor, client-side staleness prune

