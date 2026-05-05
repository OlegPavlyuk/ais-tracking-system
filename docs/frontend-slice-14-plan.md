# Slice #14 — Frontend: Vessel Detail Panel + Sanctions Badge

Single source of truth for Slice #14. All decisions below were locked in a
HITL grilling session. Do not re-litigate any decision without explicit user
approval.

---

## Goal and Scope

Add a vessel detail panel that opens when the user clicks a vessel marker on
the map. The panel fetches the full vessel profile from `GET /api/vessels/:id`,
shows a sanctions badge driven by live WS data, and attributes OpenSanctions
data per the CC-BY-NC 4.0 license requirement.

**In scope:**
- Right-side overlapping detail panel (360px fixed width)
- Click-to-open / close-button-to-dismiss
- TanStack Query for the detail request
- Sanctions status pill + compact match list with attribution
- mmsi-only fallback when `vesselId` is not yet known
- "Outside viewport" graceful state
- Ship type human-readable label (range-based lookup)
- `vessel.enriched` badge updates via existing Zustand path
- Tests: `shipTypeLabel.spec.ts` + `VesselDetailPanel.spec.tsx`

**Out of scope (held the line):**
- Track visualization → Slice #15
- Mobile / responsive panel mechanics (bottom sheet)
- Map resize on panel open
- Query cache invalidation on `vessel.enriched`
- Sanctions admin UI
- Any backend changes

---

## Locked Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Panel layout | Right-anchored, fixed 360px, `fixed right-0 top-0` over the map. No map resize. Desktop-first. z-index high enough to clear MapLibre controls (use `z-50` or explicit `z-[200]`). |
| 2 | Selection state | `const [selectedMmsi, setSelectedMmsi] = useState<string \| null>(null)` in `App.tsx`. Zustand owns live AIS data; local state owns UI selection. |
| 3 | Click wiring | New hook `web/src/map/useVesselClick.ts`. Registers `map.on('click', 'vessels', handler)`. Reads `mmsi` from `e.features?.[0]?.properties?.mmsi` (type-guard to string). Calls `onSelect(mmsi)`. Sets `map.getCanvas().style.cursor = 'pointer'` on `mouseenter 'vessels'`; resets on `mouseleave 'vessels'`. Cleans up all listeners on unmount. |
| 4 | TanStack Query | Install `@tanstack/react-query`. Wrap in `<QueryClientProvider>` in `main.tsx`. Add `fetchVesselDetail(vesselId: string, signal: AbortSignal): Promise<VesselDetailRow>` to `web/src/api/client.ts` — signal is required, passed from `queryFn: ({ signal }) => fetchVesselDetail(vesselId, signal)`. Use object-style call: `useQuery({ queryKey: ['vessel-detail', vesselId], queryFn: ..., enabled: !!vesselId, staleTime: 30_000, retry: 1, refetchOnWindowFocus: false })`. No polling. |
| 5 | Live enrichment updates | Sanctions badge reads `sanctionsStatus` / `sanctionsMatches` from Zustand (`vessels.get(selectedMmsi)`). Zustand data takes precedence over query data for all sanctions fields. Fall back to query data only when Zustand entry is absent. No TanStack Query cache invalidation or patching on `vessel.enriched`. |
| 6 | Sanctions badge | Pill labels: `null` → "Unchecked"; `'clear'` → "No match"; `'candidate'` → "Candidate match"; `'sanctioned'` → "Sanctioned match". Subdued styling. If `sanctionsMatches.length > 0`, show compact list: entity name, source label (OFAC / OpenSanctions), match method (IMO / MMSI / Name candidate). For OpenSanctions matches (`source === 'opensanctions'`), show attribution line: _Data: OpenSanctions (CC BY-NC 4.0)_. No attribution for OFAC. |
| 7 | Panel states (explicit) | Three distinct render states based on Zustand + query: **(1) vessel present + vesselId known** — fire detail query, show full panel; **(2) vessel present, vesselId null** — skip query, show mmsi-only fallback with message "Full vessel profile is not available yet."; **(3) vessel absent from Zustand** (outside viewport) — show last query data if available, suppress live position block, show "Vessel is outside the current viewport." indicator. |
| 8 | Panel field order | 1. Header (name or "MMSI {mmsi}") + close button. 2. Identity (MMSI, IMO, callSign, shipType human-readable). 3. Sanctions section (pill + match list). 4. Live position from Zustand (SOG in knots, COG in °, heading in °, navStatus). 5. Destination (if present). 6. Dimensions (only if at least one field non-null). Live position fields formatted: SOG → `{n} kn`, COG → `{n}°`, heading → `{n}°`, null fields → `—`. Range-based ship type: 60–69 → Passenger, 70–79 → Cargo, 80–89 → Tanker, else → `Type {code}`, null → `—`. |
| 9 | Vessel leaves viewport | Keep panel open. Show "Vessel is outside the current viewport." indicator. Hide / neutralize live position block (show `—` or collapse). Do not show stale position as current. User closes explicitly. |
| 10 | Close / switch | Close button → `setSelectedMmsi(null)` → panel unmounts. Do not manually clear query cache. Clicking another vessel while panel is open directly replaces selection (`setSelectedMmsi(newMmsi)`). Panel stays open, content updates. Cache reuse via default `gcTime`. |
| 11 | Tests | `web/src/lib/shipTypeLabel.spec.ts` (pure fn, 5 cases) + `web/src/components/VesselDetailPanel.spec.tsx` (8 cases). No MapLibre mocks. No e2e. Use real `QueryClient` + `vi.fn()` for fetch in component tests. |

---

## Implementation Phases

### Phase 1 — Dependencies + API layer

- [x] 1.1 Install `@tanstack/react-query` in `web/`.
- [x] 1.2 Add `<QueryClientProvider>` with a configured `QueryClient` (`staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`) in `web/src/main.tsx`.
- [x] 1.3 Add `fetchVesselDetail(vesselId: string, signal: AbortSignal): Promise<VesselDetailRow>` to `web/src/api/client.ts`. Signal is required. Reuse `ApiError`. Mirror `VesselDetailRow` + `VesselSanctionMatch` shapes locally in `web/src/store/types.ts` (backend type is not importable from the frontend safely; replicate the shape).
- [x] 1.4 Add `shipTypeLabel(code: number | null): string` to `web/src/lib/shipTypeLabel.ts`. Range lookup: 60–69 → `'Passenger'`, 70–79 → `'Cargo'`, 80–89 → `'Tanker'`, null → `'—'`, else → `` `Type ${code}` ``.

### Phase 2 — Map click hook

- [x] 2.1 Create `web/src/map/useVesselClick.ts`.
  - `useEffect` depending on `[map, onSelect]`.
  - Register `map.on('click', 'vessels', clickHandler)`.
  - In `clickHandler`: read `mmsi` from `e.features?.[0]?.properties?.mmsi`; type-guard to non-empty string; call `onSelect(mmsi)`.
  - Register `map.on('mouseenter', 'vessels', ...)` → set cursor `pointer`.
  - Register `map.on('mouseleave', 'vessels', ...)` → reset cursor `''`.
  - Return cleanup removing all three listeners.

### Phase 3 — Detail panel component

- [x] 3.1 Create `web/src/components/VesselDetailPanel.tsx`.
  - Props: `mmsi: string`, `onClose: () => void`.
  - Determine state from Zustand + query (three states per decision #7).
  - For sanctions: prefer Zustand `sanctionsStatus` / `sanctionsMatches` over query data.
  - Use `useQuery({ queryKey: ['vessel-detail', vesselId], queryFn: ({ signal }) => fetchVesselDetail(vesselId!, signal), enabled: !!vesselId, staleTime: 30_000, retry: 1, refetchOnWindowFocus: false })`.
  - Render field order per decision #8. Format live fields (° and kn).
  - Sanctions sub-section: pill + compact match list with inline OpenSanctions attribution.
  - Positioning: `fixed right-0 top-0 h-full w-[360px] bg-white shadow-xl z-[200] overflow-y-auto`.

### Phase 4 — App wiring

- [x] 4.1 Add `useVesselClick(map, setSelectedMmsi)` in `App.tsx`.
- [x] 4.2 Add `selectedMmsi` state + conditional `{selectedMmsi && <VesselDetailPanel mmsi={selectedMmsi} onClose={() => setSelectedMmsi(null)} />}` in `App.tsx` return.

### Phase 5 — Tests

- [x] 5.1 `web/src/lib/shipTypeLabel.spec.ts`: cargo (70), tanker (80), passenger (60), unknown (99) → `'Type 99'`, null → `'—'`.
- [x] 5.2 `web/src/components/VesselDetailPanel.spec.tsx` (wrap each in `QueryClientProvider` with fresh `QueryClient`):
  - renders mmsi-only fallback (state 2) when `vesselId` is null in Zustand
  - renders profile/detail data (state 1) from query response
  - renders correct pill label for each `sanctionsStatus` value (`null`, `'clear'`, `'candidate'`, `'sanctioned'`)
  - renders match list when `sanctionsMatches` present
  - renders OpenSanctions attribution for `source === 'opensanctions'`; no attribution for `'ofac'`
  - shows "outside viewport" indicator (state 3) when vessel absent from Zustand
  - suppresses / shows `—` for live position fields in state 3

### Phase 6 — Wrap-up

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm test` green in `web/`.
- [x] 6.2 Manual smoke test: click vessel → panel opens → sanctions badge visible → close → panel gone → click different vessel → switches directly.
- [x] 6.3 Commit: `feat: vessel detail panel + sanctions badge (slice #14)`.
- [x] 6.4 Mark slice #14 complete in `docs/issues.md` and this file's Progress Tracker.

---

## Acceptance Checklist

- [x] Click on marker opens detail panel populated from `GET /api/vessels/:id`.
- [x] Sanctions status renders as a visible badge with source attribution.
- [x] OpenSanctions data shown with CC-BY-NC 4.0 attribution inline per match.
- [x] `vessel.enriched` WS messages update the open panel live (via Zustand).
- [x] Closing the panel cleans up: query disabled, panel unmounts, selection cleared.

---

## Test Plan

| File | Cases |
|------|-------|
| `web/src/lib/shipTypeLabel.spec.ts` | cargo (70), tanker (80), passenger (60), unknown (99), null |
| `web/src/components/VesselDetailPanel.spec.tsx` | state-2 fallback; state-1 profile render; pill × 4 statuses; match list; OpenSanctions attribution; OFAC no-attribution; state-3 outside-viewport; state-3 position fields suppressed |

No e2e. No MapLibre mocking.

---

## Out of Scope

- Track visualization → Slice #15
- Mobile / responsive panel (bottom sheet, drag handle)
- Map resize when panel opens
- Query cache patching / invalidation on `vessel.enriched`
- Vessel count in panel
- Slice #9 OpenSanctions ETL (separate; attribution in panel is sufficient here)
- Any backend changes

---

## Progress Tracker

| Phase | Status |
|-------|--------|
| 1 — Dependencies + API layer | complete |
| 2 — Map click hook | complete |
| 3 — Detail panel component | complete |
| 4 — App wiring | complete |
| 5 — Tests | complete |
| 6 — Wrap-up | complete |

