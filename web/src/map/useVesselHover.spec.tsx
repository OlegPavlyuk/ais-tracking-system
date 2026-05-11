import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVesselHover } from './useVesselHover';

const popupState = vi.hoisted(() => ({
  instances: [] as Array<{ element: HTMLDivElement }>,
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Popup: class MockPopup {
      readonly element = document.createElement('div');
      readonly content = document.createElement('div');
      private readonly listeners = new Map<string, Array<() => void>>();

      constructor() {
        this.element.className = 'maplibregl-popup';
        this.content.className = 'maplibregl-popup-content';
        this.element.appendChild(this.content);
        popupState.instances.push(this);
      }

      on(event: string, handler: () => void) {
        const handlers = this.listeners.get(event) ?? [];
        handlers.push(handler);
        this.listeners.set(event, handlers);
        return this;
      }

      setLngLat() {
        return this;
      }

      setDOMContent(node: HTMLElement) {
        this.content.replaceChildren(node);
        return this;
      }

      addTo() {
        if (!this.element.isConnected) {
          document.body.appendChild(this.element);
        }
        for (const handler of this.listeners.get('open') ?? []) {
          handler();
        }
        return this;
      }

      remove() {
        this.element.remove();
        return this;
      }

      getElement() {
        return this.element;
      }
    },
  },
}));

interface MockMap {
  handlers: Record<string, Array<(event?: { point: { x: number; y: number } }) => void>>;
  getContainer: () => HTMLDivElement;
  on: (event: string, handler: (event?: { point: { x: number; y: number } }) => void) => void;
  off: (event: string, handler: (event?: { point: { x: number; y: number } }) => void) => void;
  queryRenderedFeatures: ReturnType<typeof vi.fn>;
  project: ReturnType<typeof vi.fn>;
}

function createMockMap(): MockMap {
  const handlers: MockMap['handlers'] = {};
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(container);

  return {
    handlers,
    getContainer: () => container,
    on: (event, handler) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
    off: (event, handler) => {
      handlers[event] = (handlers[event] ?? []).filter((candidate) => candidate !== handler);
    },
    queryRenderedFeatures: vi.fn(() => []),
    project: vi.fn((coords: [number, number]) => ({ x: coords[0], y: coords[1] })),
  };
}

function HookHarness({ map, disabled }: { map: MockMap; disabled: boolean }) {
  useVesselHover(map as never, disabled);
  return null;
}

beforeEach(() => {
  popupState.instances.length = 0;
  let rafId = 0;
  const rafCallbacks = new Map<number, FrameRequestCallback>();

  vi.stubGlobal(
    'requestAnimationFrame',
    ((cb: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.set(id, cb);
      window.setTimeout(() => {
        const callback = rafCallbacks.get(id);
        if (!callback) return;
        rafCallbacks.delete(id);
        callback(0);
      }, 0);
      return id;
    }) as typeof requestAnimationFrame,
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      rafCallbacks.delete(id);
    }),
  );
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('useVesselHover', () => {
  it('suppresses hover popup while detail popup is open and resumes after close', async () => {
    const map = createMockMap();
    map.queryRenderedFeatures.mockReturnValue([
      {
        geometry: { coordinates: [30, 43] },
        properties: {
          mmsi: '123456789',
          vesselName: 'HOVER VESSEL',
          navStatusLabel: 'Under way',
          occurredAt: '2024-01-01T00:00:00.000Z',
        },
      },
    ]);

    const { rerender } = render(<HookHarness map={map} disabled={false} />);

    map.handlers.mousemove?.[0]?.({ point: { x: 30, y: 43 } });

    expect(await screen.findByText('HOVER VESSEL')).toBeInTheDocument();

    rerender(<HookHarness map={map} disabled />);

    await waitFor(() => {
      expect(screen.queryByText('HOVER VESSEL')).not.toBeInTheDocument();
    });

    map.handlers.mousemove?.[0]?.({ point: { x: 30, y: 43 } });

    await waitFor(() => {
      expect(screen.queryByText('HOVER VESSEL')).not.toBeInTheDocument();
    });

    rerender(<HookHarness map={map} disabled={false} />);
    map.handlers.mousemove?.[0]?.({ point: { x: 30, y: 43 } });

    expect(await screen.findByText('HOVER VESSEL')).toBeInTheDocument();
  });

  it('reuses one overlay node, skips rebuilds for the same vessel, and cleans up listeners', async () => {
    const map = createMockMap();
    const feature = {
      geometry: { coordinates: [30, 43] },
      properties: {
        mmsi: '123456789',
        vesselName: 'HOVER VESSEL',
        navStatusLabel: 'Under way',
        occurredAt: '2024-01-01T00:00:00.000Z',
      },
    };
    map.queryRenderedFeatures.mockReturnValue([feature]);

    const { unmount } = render(<HookHarness map={map} disabled={false} />);

    expect(map.getContainer().querySelectorAll('.vessel-hover-overlay')).toHaveLength(1);
    expect(map.handlers.mousemove).toHaveLength(1);
    expect(map.handlers.mouseout).toHaveLength(1);

    map.handlers.mousemove?.[0]?.({ point: { x: 30, y: 43 } });
    expect(await screen.findByText('HOVER VESSEL')).toBeInTheDocument();

    const overlay = map.getContainer().querySelector('.vessel-hover-overlay');
    const content = overlay?.firstElementChild;
    const firstQueryCount = map.queryRenderedFeatures.mock.calls.length;

    map.handlers.mousemove?.[0]?.({ point: { x: 30, y: 43 } });

    await waitFor(() => {
      expect(map.queryRenderedFeatures.mock.calls.length).toBe(firstQueryCount + 1);
    });
    expect(map.getContainer().querySelector('.vessel-hover-overlay')).toBe(overlay);
    expect(overlay?.firstElementChild).toBe(content);

    unmount();

    expect(map.getContainer().querySelector('.vessel-hover-overlay')).toBeNull();
    expect(map.handlers.mousemove).toHaveLength(0);
    expect(map.handlers.mouseout).toHaveLength(0);
  });
});
