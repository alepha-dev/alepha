/**
 * Setup jsdom mocks required for testing React components that use browser APIs.
 * Covers the platform APIs jsdom does not implement and a component library
 * reaches for on mount: the viewport queries, the two observers, and the two
 * scroll and style helpers.
 *
 * ⚠️ Every branch is guarded on the global being absent, so this is a no-op
 * for anything already installed. In a project using `jsdomProject` from
 * `alepha/testing/vitest`, `matchMedia` is already polyfilled by its
 * `setupFiles`, and this only adds the rest.
 *
 * Call this in your test setup (e.g., `beforeAll`) before rendering any components.
 *
 * @example
 * ```typescript
 * import { setupJsdomMocks } from "alepha/testing/react";
 *
 * beforeAll(() => {
 *   setupJsdomMocks();
 * });
 * ```
 */
export const setupJsdomMocks = (): void => {
  // Absent from jsdom entirely. Anything that asks the platform about the
  // viewport or the user's preferences reaches for it on mount.
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  // Absent from jsdom. Any component that measures itself reaches for it.
  if (typeof window !== "undefined" && !window.ResizeObserver) {
    (window as any).ResizeObserver = class ResizeObserver {
      protected callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(_target: Element, _options?: ResizeObserverOptions): void {}
      unobserve(_target: Element): void {}
      disconnect(): void {}
    };
  }

  // Mock IntersectionObserver - used for lazy loading and virtualization
  if (typeof window !== "undefined" && !window.IntersectionObserver) {
    (window as any).IntersectionObserver = class IntersectionObserver {
      protected callback: IntersectionObserverCallback;

      constructor(
        callback: IntersectionObserverCallback,
        _options?: IntersectionObserverInit,
      ) {
        this.callback = callback;
      }

      observe(_target: Element): void {}
      unobserve(_target: Element): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }

      get root(): Element | null {
        return null;
      }
      get rootMargin(): string {
        return "";
      }
      get thresholds(): ReadonlyArray<number> {
        return [];
      }
    };
  }

  // Mock scrollTo - used by many UI components
  if (typeof window !== "undefined" && !window.scrollTo) {
    window.scrollTo = () => {};
  }

  // Mock getComputedStyle for CSS calculations
  if (typeof window !== "undefined" && !window.getComputedStyle) {
    (window as any).getComputedStyle = () => ({
      getPropertyValue: () => "",
    });
  }
};

/**
 * Type declarations for mocked APIs.
 */
declare global {
  interface Window {
    ResizeObserver: typeof ResizeObserver;
    IntersectionObserver: typeof IntersectionObserver;
  }
}
