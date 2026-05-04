import { create } from 'zustand';
import type { Bbox } from '@/lib/protocol';
import {
  applyEnriched,
  applyPosition,
  applySnapshotRows,
  applyStatic,
} from './mergeReducer';
import type {
  PositionEvent,
  SnapshotRow,
  StaticEvent,
  Vessel,
  VesselEnrichedEvent,
} from './types';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

interface VesselsState {
  vessels: ReadonlyMap<string, Vessel>;
  bbox: Bbox | null;
  wsStatus: WsStatus;
  error: ApiError | null;

  setBbox: (b: Bbox) => void;
  setStatus: (s: WsStatus) => void;
  setError: (e: ApiError | null) => void;

  applySnapshot: (rows: readonly SnapshotRow[]) => void;
  applyPosition: (ev: PositionEvent) => void;
  applyStatic: (ev: StaticEvent) => void;
  applyEnriched: (ev: VesselEnrichedEvent) => void;
}

export const useVesselsStore = create<VesselsState>((set) => ({
  vessels: new Map(),
  bbox: null,
  wsStatus: 'idle',
  error: null,

  setBbox: (b) => set({ bbox: b }),
  setStatus: (s) => set({ wsStatus: s }),
  setError: (e) => set({ error: e }),

  applySnapshot: (rows) => set((s) => ({ vessels: applySnapshotRows(s.vessels, rows) })),
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
