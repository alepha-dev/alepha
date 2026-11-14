import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import { useFolioFind } from "./useFolioFind.ts";

/**
 * Records the ranges handed to the CSS Custom Highlight API. jsdom ships
 * neither `Highlight` nor `CSS.highlights`, so the hook's real code path
 * would silently degrade to scroll-only and the offset→node mapping — the
 * part actually worth testing — would never run. Standing the API up as a
 * fake is what makes "which text did it highlight" an assertion instead of
 * an inference.
 */
class FakeHighlight {
  ranges: Range[];

  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

interface HighlightGlobals {
  Highlight?: unknown;
  CSS?: { highlights?: Map<string, FakeHighlight> };
}

const globals = window as unknown as HighlightGlobals;

let originalHighlight: unknown;
let originalHighlights: Map<string, FakeHighlight> | undefined;
let originalScrollIntoView: unknown;

beforeEach(() => {
  originalHighlight = globals.Highlight;
  originalHighlights = globals.CSS?.highlights;
  globals.Highlight = FakeHighlight;
  if (globals.CSS) globals.CSS.highlights = new Map();

  // jsdom implements no layout, so `scrollIntoView` does not exist on
  // `Element` at all — without this the hook throws the moment it has a
  // match to scroll to.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  originalScrollIntoView = proto.scrollIntoView;
  proto.scrollIntoView = () => {};
});

afterEach(() => {
  globals.Highlight = originalHighlight;
  if (globals.CSS) globals.CSS.highlights = originalHighlights;
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = originalScrollIntoView;
  document.body.innerHTML = "";
});

const mount = (html: string): HTMLElement => {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
};

const highlights = (): Map<string, FakeHighlight> =>
  globals.CSS?.highlights ?? new Map();

describe("useFolioFind", () => {
  it("counts every match across the rendered text nodes", async ({
    expect,
  }) => {
    const container = mount(
      "<p>alpha <strong>beta</strong> alpha</p><p>gamma alpha</p>",
    );
    const { result } = renderHook(() =>
      useFolioFind(container, container.textContent ?? ""),
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("alpha"));

    expect(result.current.total).toBe(3);
    expect(result.current.active).toBe(0);
    expect(highlights().get("folio-find")?.ranges).toHaveLength(3);
  });

  it("matches a phrase split across two text nodes", async ({ expect }) => {
    // The bold tag splits "the sealed door" into three text nodes; a naive
    // per-node search finds nothing at all here.
    const container = mount("<p>the <strong>sealed</strong> door</p>");
    const { result } = renderHook(() =>
      useFolioFind(container, container.textContent ?? ""),
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("sealed door"));

    expect(result.current.total).toBe(1);
    const active = highlights().get("folio-find-active")?.ranges[0];
    expect(active?.toString()).toBe("sealed door");
  });

  it("steps and wraps in both directions", async ({ expect }) => {
    const container = mount("<p>one two one two one</p>");
    const { result } = renderHook(() =>
      useFolioFind(container, container.textContent ?? ""),
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("one"));
    expect(result.current.total).toBe(3);

    act(() => result.current.next());
    expect(result.current.active).toBe(1);

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.active).toBe(0);

    act(() => result.current.previous());
    expect(result.current.active).toBe(2);
    expect(highlights().get("folio-find-active")?.ranges).toHaveLength(1);
  });

  it("reports no matches and registers no highlight for a miss", async ({
    expect,
  }) => {
    const container = mount("<p>alpha beta</p>");
    const { result } = renderHook(() =>
      useFolioFind(container, container.textContent ?? ""),
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("gamma"));

    expect(result.current.total).toBe(0);
    expect(highlights().has("folio-find")).toBe(false);
  });

  it("clears the highlights when the bar closes", async ({ expect }) => {
    const container = mount("<p>alpha alpha</p>");
    const { result } = renderHook(() =>
      useFolioFind(container, container.textContent ?? ""),
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("alpha"));
    expect(highlights().has("folio-find")).toBe(true);

    act(() => result.current.close());

    // A highlight lives on the document, not on the component — a stale one
    // would keep painting over whatever the user navigates to next.
    expect(result.current.open).toBe(false);
    expect(highlights().has("folio-find")).toBe(false);
    expect(highlights().has("folio-find-active")).toBe(false);
  });

  it("clears the highlights on unmount", async ({ expect }) => {
    const container = mount("<p>alpha alpha</p>");
    const { result, unmount } = renderHook(() =>
      useFolioFind(container, container.textContent ?? ""),
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("alpha"));
    expect(highlights().has("folio-find")).toBe(true);

    unmount();

    expect(highlights().has("folio-find")).toBe(false);
  });

  it("re-counts when the document changes under an open bar", async ({
    expect,
  }) => {
    const container = mount("<p>alpha beta</p>");
    const { result, rerender } = renderHook(
      (content: string) => useFolioFind(container, content),
      { initialProps: container.textContent ?? "" },
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("alpha"));
    expect(result.current.total).toBe(1);

    // The user keeps typing with the bar open. Every `Range` held by the
    // hook points into text nodes that edit just moved.
    container.innerHTML = "<p>alpha beta alpha</p>";
    rerender(container.textContent ?? "");

    expect(result.current.total).toBe(2);
  });

  it("resets the cursor when a longer query has fewer matches", async ({
    expect,
  }) => {
    const container = mount("<p>door doorway door</p>");
    const { result } = renderHook(() =>
      useFolioFind(container, container.textContent ?? ""),
    );

    act(() => result.current.show());
    act(() => result.current.setQuery("door"));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.active).toBe(2);

    act(() => result.current.setQuery("doorway"));

    expect(result.current.total).toBe(1);
    expect(result.current.active).toBe(0);
  });
});
