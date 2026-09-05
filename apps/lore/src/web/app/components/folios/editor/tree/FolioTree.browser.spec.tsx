import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import { I18n } from "../../../../services/I18n.ts";
import FolioTree from "./FolioTree.tsx";
import FolioTreeRowDefault from "./FolioTreeRow.tsx";

const DIR_A = "11111111-1111-4111-8111-111111111111";
const DIR_B = "22222222-2222-4222-8222-222222222222";

/**
 * `FolioTree` renders from the two atoms; the fallback query only runs while
 * both are empty, so seeding them keeps this spec off the network entirely.
 */
class FakeLinkProvider extends LinkProvider {
  override client(): any {
    const action = <T extends (...args: any[]) => Promise<unknown>>(fn: T) =>
      Object.assign(fn, { can: () => true });
    return new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) =>
        target[prop] ??
        action(async () => Object.assign([], { content: [], items: [] })),
    });
  }
}

class Routes {
  folio = $page({
    name: "projectFoliosFolio",
    path: "/:projectSlug/folios/:shortId",
    component: () => null,
  });
  folios = $page({
    name: "projectFolios",
    path: "/:projectSlug/folios",
    component: () => null,
  });
}

/**
 * The folio tree pane (feedback #2089).
 *
 * The report's three complaints were latency, monochrome and no press
 * feedback. Colour lives in `main.css` and is guarded by
 * `test/folio-tree-theme-tokens.spec.ts`; what is asserted here is the
 * interaction that was actually slow, and the structure that lets the rows
 * be memoised.
 */
describe("FolioTree", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const folioOf = (id: string, title: string, directoryId?: string) => ({
    id,
    shortId: Number(id.slice(0, 1)) || 1,
    projectId: 1,
    title,
    content: "",
    summary: "",
    searchText: "",
    directoryId,
    pinned: false,
    protected: false,
    tags: [],
    createdBy: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-09-04T10:00:00.000Z",
    updatedAt: "2026-09-04T10:00:00.000Z",
  });

  /**
   * A fresh tree against the CURRENT alepha instance.
   *
   * Separate from `mount` so the remount case can build a second tree over
   * the same store, which is what the list-to-folio navigation does: the
   * component is torn down and rebuilt while the app around it, and its
   * atoms, live on.
   */
  const renderTree = () =>
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <FolioTree projectId={1} projectSlug="alepha" width={260} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

  const mount = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    alepha.store.set(projectDirectoriesAtom, [
      { id: DIR_A, shortId: 1, name: "Framework" },
      { id: DIR_B, shortId: 2, name: "Lore" },
    ] as never);
    alepha.store.set(userFoliosAtom, [
      folioOf("33333333-3333-4333-8333-333333333333", "Inside A", DIR_A),
      folioOf("44444444-4444-4444-8444-444444444444", "At the root"),
    ] as never);

    const view = renderTree();
    await screen.findByText("Framework");
    // ⚠️ Wait for the collapse SEED, which is an effect and always was: the
    // tree paints fully expanded for one frame and the seed then closes every
    // directory that does not have to be open. Asserting before it settles
    // reads the pre-seed tree and every case below looks like the directory
    // failed to collapse. It became visible when the state moved into
    // `folioTreeCollapsedAtom` (feedback #2100), because an atom write is not
    // wrapped by testing-library's `act` the way a `setState` in an effect is.
    await waitFor(() => expect(screen.queryByText("Inside A")).toBeNull());
    return view;
  };

  /**
   * A click that leaves no state update in flight.
   *
   * ⚠️ `act` rather than a `waitFor` on the assertion, and the difference is
   * the whole point of these cases. Collapse state lives in
   * `folioTreeCollapsedAtom` (feedback #2100), and an atom write is not
   * wrapped by testing-library the way a `setState` is, so a bare `fireEvent`
   * leaves the re-render unflushed and the row still closed. `act` flushes
   * state and effects synchronously - and it does NOT flush a `setTimeout`,
   * so the 250ms defer these cases exist to catch would still fail them.
   * A `waitFor` would not: its default timeout is 1000ms, so it would happily
   * wait the timer out and report the bug as fixed.
   */
  const click = async (el: Element) => {
    // The ASYNC form: the atom notifies its subscribers in a microtask, so
    // the synchronous `act` flushes React but not the store. `await act`
    // drains both. It still does NOT advance timers, so the 250ms defer
    // these cases exist to catch would leave the row closed and fail them.
    await act(async () => {
      fireEvent.click(el);
    });
  };

  const rowFor = (name: string): HTMLElement => {
    const label = screen.getByText(name);
    const row = label.closest('[data-slot="folio-tree-row"]');
    expect(row).not.toBeNull();
    return row as HTMLElement;
  };

  /**
   * The heart of the report. Expanding fetched nothing even before this: the
   * tree is built from two atoms already in the store, and the 250ms was a
   * timer waiting to see whether a second click was coming.
   */
  it("opens a directory on the first click, with no timer to wait out", async () => {
    await mount();

    expect(screen.queryByText("Inside A")).toBeNull();

    await click(rowFor("Framework"));

    // No `waitFor` and no fake timers on purpose: the child has to be there
    // in the same tick the click was handled. Before this change the assert
    // below failed and only a 250ms wait made it pass.
    expect(screen.getByText("Inside A")).not.toBeNull();
  });

  it("collapses again on the next click", async () => {
    await mount();

    await click(rowFor("Framework"));
    expect(screen.getByText("Inside A")).not.toBeNull();

    await click(rowFor("Framework"));
    expect(screen.queryByText("Inside A")).toBeNull();
  });

  /**
   * ⚠️ This case used to assert the OPPOSITE, and the reversal is deliberate
   * rather than drift.
   *
   * Double click WAS the rename gesture, and the 250ms defer, then the
   * optimistic-toggle revert that replaced it, existed only to keep the
   * first click of that burst from expanding a directory on the way to a
   * rename. Feedback #2101 removed the gesture ("remove double-click for
   * rename. It's not nice. we will keep right-click to rename action for
   * that"), which takes the revert with it, and the frame of flicker the
   * revert cost.
   *
   * So the double click is now simply a click that happened twice, and the
   * two halves of this are what that has to mean: no rename, and the same
   * directory state the single click below it produces. The second half is
   * why `handleClick` keeps its `e.detail` guard - without it the burst's
   * two clicks toggle twice and land collapsed.
   *
   * Driven as a real burst rather than a bare `doubleClick`: the browser
   * fires click, click, then dblclick, and it is the SECOND click that the
   * guard exists for, so firing only the dblclick would test nothing.
   *
   * ⚠️ Each click gets its OWN `await act`, and that is load-bearing rather
   * than tidiness. The collapse set lives in an atom that notifies in a
   * microtask, so two clicks inside one `act` both read the pre-burst value
   * and the second toggle recomputes the first one's answer - the test
   * passes with the guard deleted, which is the one thing it exists to
   * catch. Separate flushes are what a real burst does anyway: the browser
   * re-renders between them.
   */
  it("does not open a rename on a double click, and leaves the directory open", async () => {
    const view = await mount();

    const row = rowFor("Framework");
    await act(async () => {
      fireEvent.click(row, { detail: 1 });
    });
    await act(async () => {
      fireEvent.click(row, { detail: 2 });
    });
    await act(async () => {
      fireEvent.doubleClick(row);
    });

    expect(view.container.querySelector("input")).toBeNull();
    // Exactly where one click leaves it.
    expect(screen.getByText("Inside A")).not.toBeNull();
  });

  /**
   * The gesture that replaced it, asserted here rather than only in the
   * context menu's own file: the report kept right-click to Rename, and
   * removing the double click makes it the only way in.
   */
  it("still opens the inline rename from the context menu", async () => {
    const view = await mount();

    await act(async () => {
      fireEvent.contextMenu(rowFor("Framework"));
    });

    const rename = await screen.findByText("Rename");
    await act(async () => {
      fireEvent.click(rename);
    });

    await waitFor(() =>
      expect(view.container.querySelector("input")).not.toBeNull(),
    );
    // And it is focused with its text selected, which is what the a11y fix
    // that removed `autoFocus` had to put back by hand.
    const input = view.container.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("marks the chevron and the row as separate targets, so the chevron still toggles", async () => {
    await mount();

    const row = rowFor("Framework");
    const chevron = row.querySelector("button");
    expect(chevron).not.toBeNull();

    await click(chevron!);
    expect(screen.getByText("Inside A")).not.toBeNull();
  });

  /**
   * The memo itself. The report's "too many ms" had a second half: every
   * visible row re-rendered on every toggle, drag handlers and context menu
   * included, because each row received the whole tree-state object.
   *
   * Asserted structurally rather than by counting renders: React exposes no
   * per-component render count to a test, and a count derived from a
   * test-only wrapper would be measuring the wrapper.
   */
  it("exports a memoised row", () => {
    expect((FolioTreeRowDefault as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  /**
   * The press feedback, and the trap that comes with it. The row is an
   * HTML5 drag SOURCE that animates `opacity` while dragging and paints the
   * ring and line drop markers; `transition: all` would put all three on a
   * timer, so the drop indicator would lag the pointer it is meant to
   * track. The transition list is therefore named, and this is what holds
   * it that way.
   */
  it("transitions only colour and transform, never all or opacity", async () => {
    await mount();

    const row = rowFor("Framework");
    expect(row.className).toContain("transition-[background-color,transform]");
    expect(row.className).not.toContain("transition-all");
    expect(row.className).toContain("active:translate-y-px");
  });

  it("drops the press transform while the row is being dragged", async () => {
    await mount();

    const row = rowFor("Framework");
    fireEvent.dragStart(row, {
      dataTransfer: { setData: () => {}, types: [], effectAllowed: "" },
    });

    // A transform on a drag source moves the browser's own drag image with
    // it, so the press is suppressed for exactly as long as the drag lasts.
    await waitFor(() =>
      expect(rowFor("Framework").className).toContain("opacity-45"),
    );
    expect(rowFor("Framework").className).not.toContain(
      "active:translate-y-px",
    );
  });

  it("draws indent guides on nested rows only", async () => {
    await mount();

    // A root-level row has nothing to guide back to.
    expect(rowFor("Framework").style.backgroundImage).toBe("");

    await click(rowFor("Framework"));

    const nested = rowFor("Inside A");
    expect(nested.style.backgroundImage).toContain("repeating-linear-gradient");
    // The guide is painted from the theme's border token, never a literal.
    expect(nested.style.backgroundImage).toContain("var(--border)");
  });

  /**
   * ⚠️ Feedback #14, returning as #2100 through a door its guard could not
   * see.
   *
   * `FoliosLayout` renders `{name === "projectFolios" ? <FolioWorkspace
   * empty /> : <NestedView />}` - two different component types in the same
   * position - so walking from the folio list to a folio UNMOUNTS the tree
   * and mounts a new one. The old `initializedRef` survived re-renders but
   * not that, so the one-time collapse seed ran again and closed every
   * directory except the opened folio's own ancestors.
   *
   * Simulated here by unmounting and re-mounting rather than by driving the
   * router: the remount IS the mechanism, and reproducing it directly is what
   * makes this case fail against the old code. The original #14 reasoning
   * never covered this path at all.
   */
  it("keeps what the reader opened across the list-to-folio remount", async () => {
    const view = await mount();

    // The reader opens a directory on /folios.
    await click(rowFor("Framework"));
    expect(screen.getByText("Inside A")).not.toBeNull();

    // ...and clicks a folio, which swaps the layout's branch.
    view.unmount();
    const again = renderTree();
    await again.findByText("Framework");

    // Still open. Before the state moved to `folioTreeCollapsedAtom` the
    // fresh mount re-seeded and closed it under them.
    expect(again.getByText("Inside A")).not.toBeNull();
  });

  it("still seeds a genuinely first visit, so the tree does not open fully expanded", async () => {
    // `mount` itself asserts this: it waits for "Inside A" to disappear
    // before returning, which only happens because the seed runs. Restated
    // here so the property is not only an implicit precondition of the
    // others - a seed that stopped running would make every case above pass
    // for the wrong reason.
    const view = await mount();
    expect(view.queryByText("Inside A")).toBeNull();
    expect(view.getByText("Framework")).not.toBeNull();
  });
});
