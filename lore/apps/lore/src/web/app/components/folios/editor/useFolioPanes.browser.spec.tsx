import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import { useFolioPanes } from "./useFolioPanes.ts";

/**
 * jsdom ships a `matchMedia` that parses a query and then answers `false`
 * to all of them, so the narrow-viewport half of this hook would never run
 * against the real one. Replacing it with a fake that actually evaluates
 * `max-width` against a width is the only way to test the breakpoints —
 * assignment, not `vi.spyOn`, per the repo's no-mocking rule.
 */
const setViewportWidth = (width: number): void => {
  (window as unknown as { matchMedia: unknown }).matchMedia = (
    query: string,
  ) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? "0");
    return {
      matches: width <= max,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
};

const WIDE = 1660;
const LAPTOP = 1200;
const NARROW = 900;

let originalMatchMedia: unknown;

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  window.localStorage.clear();
});

afterEach(() => {
  (window as unknown as { matchMedia: unknown }).matchMedia =
    originalMatchMedia;
  window.localStorage.clear();
});

describe("useFolioPanes", () => {
  it("opens both panes as columns on the design's own width", async ({
    expect,
  }) => {
    setViewportWidth(WIDE);
    const { result } = renderHook(() => useFolioPanes());

    expect(result.current.treeOpen).toBe(true);
    expect(result.current.inspectorOpen).toBe(true);
    expect(result.current.treeDrawer).toBe(false);
    expect(result.current.inspectorDrawer).toBe(false);
  });

  it("defaults the inspector closed once it would be a drawer", async ({
    expect,
  }) => {
    // 1200px: the inspector no longer fits as a column, the tree still
    // does.
    setViewportWidth(LAPTOP);
    const { result } = renderHook(() => useFolioPanes());

    expect(result.current.inspectorDrawer).toBe(true);
    expect(result.current.inspectorOpen).toBe(false);
    expect(result.current.treeDrawer).toBe(false);
    expect(result.current.treeOpen).toBe(true);
  });

  it("defaults both closed on a narrow viewport", async ({ expect }) => {
    setViewportWidth(NARROW);
    const { result } = renderHook(() => useFolioPanes());

    expect(result.current.treeDrawer).toBe(true);
    expect(result.current.inspectorDrawer).toBe(true);
    expect(result.current.treeOpen).toBe(false);
    expect(result.current.inspectorOpen).toBe(false);
  });

  it("keeps an explicit toggle across mounts, overruling the default", async ({
    expect,
  }) => {
    setViewportWidth(NARROW);
    const first = renderHook(() => useFolioPanes());

    act(() => first.result.current.toggleTree());
    expect(first.result.current.treeOpen).toBe(true);
    first.unmount();

    const second = renderHook(() => useFolioPanes());
    expect(second.result.current.treeOpen).toBe(true);
  });

  it("keeps a pane closed on a wide viewport once closed explicitly", async ({
    expect,
  }) => {
    setViewportWidth(WIDE);
    const first = renderHook(() => useFolioPanes());

    act(() => first.result.current.toggleInspector());
    expect(first.result.current.inspectorOpen).toBe(false);
    first.unmount();

    const second = renderHook(() => useFolioPanes());
    expect(second.result.current.inspectorOpen).toBe(false);
  });

  it("hides both panes in focus mode and restores them on a second press", async ({
    expect,
  }) => {
    setViewportWidth(WIDE);
    const { result } = renderHook(() => useFolioPanes());

    act(() => result.current.toggleFocus());
    expect(result.current.treeOpen).toBe(false);
    expect(result.current.inspectorOpen).toBe(false);

    act(() => result.current.toggleFocus());
    expect(result.current.treeOpen).toBe(true);
    expect(result.current.inspectorOpen).toBe(true);
  });

  it("does not record a preference for what focus mode hid", async ({
    expect,
  }) => {
    setViewportWidth(WIDE);
    const first = renderHook(() => useFolioPanes());

    act(() => first.result.current.toggleFocus());
    first.unmount();

    // Focus mode is a transient override: a session that ends inside it
    // must not come back with the panes remembered as closed.
    const second = renderHook(() => useFolioPanes());
    expect(second.result.current.treeOpen).toBe(true);
    expect(second.result.current.inspectorOpen).toBe(true);
  });

  it("leaves focus mode when a pane is asked for explicitly", async ({
    expect,
  }) => {
    setViewportWidth(WIDE);
    const { result } = renderHook(() => useFolioPanes());

    act(() => result.current.toggleFocus());
    act(() => result.current.toggleTree());

    // Asking for the tree leaves focus mode entirely, which restores the
    // inspector to its own preference too — otherwise the toggle would
    // record a preference and visibly do nothing.
    expect(result.current.treeOpen).toBe(true);
    expect(result.current.inspectorOpen).toBe(true);
  });
});
