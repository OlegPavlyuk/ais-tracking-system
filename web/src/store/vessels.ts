import { create } from 'zustand';
import {
  applyEnriched,
  applyPosition,
  applySnapshotRows,
  applyStatic,
  pruneStaleVessels,
  SNAPSHOT_RETENTION_MS,
} from './mergeReducer';
import type {
  PositionEvent,
  SnapshotRow,
  StaticEvent,
  Vessel,
  VesselEnrichedEvent,
} from './types';
import type { ApiErrorData } from '@/api/client';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

interface VesselsState {
  vessels: ReadonlyMap<string, Vessel>;
  wsStatus: WsStatus;
  error: ApiErrorData | null;

  setStatus: (s: WsStatus) => void;
  setError: (e: ApiErrorData | null) => void;
  pruneStale: () => void;

  applySnapshot: (rows: readonly SnapshotRow[]) => void;
  applyPosition: (ev: PositionEvent) => void;
  applyStatic: (ev: StaticEvent) => void;
  applyEnriched: (ev: VesselEnrichedEvent) => void;
}

export const useVesselsStore = create<VesselsState>((set) => ({
  vessels: new Map(),
  wsStatus: 'idle',
  error: null,

  setStatus: (s) => set({ wsStatus: s }),
  setError: (e) => set({ error: e }),
  pruneStale: () =>
    set((s) => {
      const next = pruneStaleVessels(s.vessels, Date.now(), SNAPSHOT_RETENTION_MS);
      return next === s.vessels ? {} : { vessels: next };
    }),

  applySnapshot: (rows) =>
    set((s) => ({
      vessels: pruneStaleVessels(
        applySnapshotRows(s.vessels, rows),
        Date.now(),
        SNAPSHOT_RETENTION_MS,
      ),
    })),
  applyPosition: (ev) =>
    set((s) => {
      const next = applyPosition(s.vessels, ev);
      return next === s.vessels ? {} : { vessels: next };
    }),
  applyStatic: (ev) => set((s) => ({ vessels: applyStatic(s.vessels, ev) })),
  applyEnriched: (ev) =>
    set((s) => {
      const next = applyEnriched(s.vessels, ev);
      return next === s.vessels ? {} : { vessels: next };
    }),
}));
