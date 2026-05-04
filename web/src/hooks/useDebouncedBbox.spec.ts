import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bbox } from '@/lib/protocol';
import { DEFAULT_DEBOUNCE_MS, useDebouncedBbox } from './useDebouncedBbox';

const A: Bbox = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
const B: Bbox = { minLon: 2, minLat: 2, maxLon: 3, maxLat: 3 };
const C: Bbox = { minLon: 4, minLat: 4, maxLon: 5, maxLat: 5 };

describe('useDebouncedBbox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value synchronously', () => {
    const { result } = renderHook(({ b }: { b: Bbox | null }) => useDebouncedBbox(b), {
      initialProps: { b: A },
    });
    expect(result.current).toEqual(A);
  });

  it('emits the trailing value only after the delay elapses', () => {
    const { result, rerender } = renderHook(({ b }: { b: Bbox | null }) => useDebouncedBbox(b), {
      initialProps: { b: A },
    });
    rerender({ b: B });
    expect(result.current).toEqual(A);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS - 1);
    });
    expect(result.current).toEqual(A);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual(B);
  });

  it('coalesces rapid changes and emits only the final value', () => {
    const { result, rerender } = renderHook(({ b }: { b: Bbox | null }) => useDebouncedBbox(b), {
      initialProps: { b: A },
    });
    rerender({ b: B });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ b: C });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toEqual(A);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    });
    expect(result.current).toEqual(C);
  });

  it('does not re-emit when the bbox is identical (no change)', () => {
    const { result, rerender } = renderHook(({ b }: { b: Bbox | null }) => useDebouncedBbox(b), {
      initialProps: { b: A },
    });
    rerender({ b: { ...A } });
    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2);
    });
    expect(result.current).toEqual(A);
  });

  it('respects a custom delay', () => {
    const { result, rerender } = renderHook(
      ({ b }: { b: Bbox | null }) => useDebouncedBbox(b, 1000),
      { initialProps: { b: A } },
    );
    rerender({ b: B });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toEqual(A);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toEqual(B);
  });
});
