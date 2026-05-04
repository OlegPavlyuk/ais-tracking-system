import { useEffect, useRef, useState } from 'react';
import type { Bbox } from '@/lib/protocol';
import { bboxEquals } from '@/lib/coverageBbox';

export const DEFAULT_DEBOUNCE_MS = 300;

export function useDebouncedBbox(bbox: Bbox | null, delayMs = DEFAULT_DEBOUNCE_MS): Bbox | null {
  const [value, setValue] = useState<Bbox | null>(bbox);
  const lastEmittedRef = useRef<Bbox | null>(bbox);

  useEffect(() => {
    if (bbox === null) return;
    const last = lastEmittedRef.current;
    if (last && bboxEquals(last, bbox)) return;
    const t = setTimeout(() => {
      lastEmittedRef.current = bbox;
      setValue(bbox);
    }, delayMs);
    return () => clearTimeout(t);
  }, [bbox, delayMs]);

  return value;
}
