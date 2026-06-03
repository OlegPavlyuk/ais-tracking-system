import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from './MapView';

const mocks = vi.hoisted(() => ({
  maps: [] as Array<{
    handlers: Map<string, Set<(event?: unknown) => void>>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emit: (type: string, event?: unknown) => void;
  }>,
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class MockMap {
      handlers = new Map<string, Set<(event?: unknown) => void>>();
      on = vi.fn((type: string, handler: (event?: unknown) => void) => {
        const handlers = this.handlers.get(type) ?? new Set<(event?: unknown) => void>();
        handlers.add(handler);
        this.handlers.set(type, handlers);
        return this;
      });
      off = vi.fn((type: string, handler: (event?: unknown) => void) => {
        this.handlers.get(type)?.delete(handler);
        return this;
      });
      addControl = vi.fn();
      remove = vi.fn();
      hasImage = vi.fn(() => false);
      addImage = vi.fn();
      getSource = vi.fn(() => undefined);
      getLayer = vi.fn(() => undefined);
      addSource = vi.fn();
      addLayer = vi.fn();

      constructor() {
        mocks.maps.push(this);
      }

      emit(type: string, event?: unknown): void {
        for (const handler of this.handlers.get(type) ?? []) {
          handler(event);
        }
      }
    },
  },
}));

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    this.onload?.();
  }
}

describe('MapView', () => {
  beforeEach(() => {
    mocks.maps.length = 0;
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reports map errors before initialization completes', () => {
    const onError = vi.fn();
    render(<MapView onReady={vi.fn()} onError={onError} />);

    act(() => {
      mocks.maps[0]!.emit('error', { error: new Error('bad style') });
    });

    expect(onError).toHaveBeenCalledWith(new Error('Map failed to initialize: bad style'));
  });

  it('does not report runtime map errors after initialization completes', async () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    render(<MapView onReady={onReady} onError={onError} />);
    const map = mocks.maps[0]!;

    await act(async () => {
      map.emit('load');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    act(() => {
      map.emit('error', { error: new Error('tile failed') });
    });

    expect(onError).not.toHaveBeenCalled();
  });
});
