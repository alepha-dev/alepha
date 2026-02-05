/**
 * Setup jsdom mocks required for testing React components that use browser APIs.
 * This includes mocks needed by Mantine UI components and other common browser APIs.
 *
 * Call this in your test setup (e.g., `beforeAll`) before rendering any components.
 *
 * @example
 * ```typescript
 * import { setupJsdomMocks } from "alepha/react/testing";
 *
 * beforeAll(() => {
 *   setupJsdomMocks();
 * });
 * ```
 */
export const setupJsdomMocks = (): void => {
  // Mock window.matchMedia - required by Mantine for responsive styles
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

  // Mock ResizeObserver - required by Mantine ScrollArea and other components
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
