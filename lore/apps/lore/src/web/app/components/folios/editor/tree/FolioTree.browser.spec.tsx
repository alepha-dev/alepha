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
import FolioTree, { type FolioTreeProps } from "./FolioTree.tsx";

const DIR_A = "11111111-1111-4111-8111-111111111111";
const DIR_B = "22222222-2222-4222-8222-222222222222";

/**
 * Every action the tree calls, in order, so a case can assert what was SENT
 * and not only what was clicked. Reset per case by the `afterEach` below.
 */
const calls: Array<{ name: string; input: any }> = [];

/**
 * `FolioTree` renders from the two atoms; the fallback query only runs while
 * both are empty, so seeding them keeps this spec off the network entirely.
 *
 * The reply carries `id` / `shortId` as well as the list shape, because a
 * create reads them back out: it opens the new row in rename mode and
 * navigates to it.
 */
class FakeLinkProvider extends LinkProvider {
  override client(): any {
    const action = (name: string) =>
      Object.assign(
        async (input: any) => {
          calls.push({ name, input });
          return Object.assign([], {
            content: [],
            items: [],
            id: "55555555-5555-4555-8555-555555555555",
            shortId: 5,
          });
        },
        { can: () => true },
      );
    return new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => target[prop] ?? action(prop),
    });
  }
}

/**
 * The same fake with every action's `can()` answering false, which is what a
 * Viewer's client looks like: `canWrite` is `folioApi.create.can()` and
 * nothing else.
 */
class ReadOnlyLinkProvider extends FakeLinkProvider {
  override client(): any {
    const client = super.client();
    return new Proxy(client, {
      get: (target, prop: string) =>
        Object.assign((target as any)[prop], { can: () => false }),
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
 * The folio tree pane, and only what is LORE's about it.
 *
 * ⚠️ The rows, the indent geometry, the disclosure, the memo, the drag zones
 * and the rename input moved to `@alepha/ui`'s `TreeView` (epic #E40), and
 * their cases moved with them: click-to-open and click-to-close, the
 * `e.detail` double-click guard, the chevron and the row as separate
 * targets, the memoised row, the named transition list, the press transform
 * dropped while dragging, and the whole indent-guide spec (which was its own
 * file here). They are `packages/@alepha/ui/src/components/tree-view/
 * __tests__/`, and duplicating them here would mean two files going red for
 * one bug and neither of them owning it.
 *
 * What is left is what only Lore can break: the collapse atom surviving the
 * remount `FoliosLayout` causes, the per-project seed, the reveal effect
 * (feedback #2114), and Lore's own context menu reaching the shared rename.
 * Colour lives in `main.css` and is still guarded by
 * `test/folio-tree-theme-tokens.spec.ts`.
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
    calls.length = 0;
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
  const renderTree = (props: Partial<FolioTreeProps> = {}) =>
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <FolioTree
            projectId={1}
            projectSlug="alepha"
            width={260}
            onCollapse={() => {}}
            {...props}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

  const mount = async (
    props: Partial<FolioTreeProps> = {},
    readOnly = false,
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({
        provide: LinkProvider,
        use: readOnly ? ReadOnlyLinkProvider : FakeLinkProvider,
      })
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

    const view = renderTree(props);
    await screen.findByText("Framework");
    // ⚠️ Wait for the collapse SEED, which is an effect and always was: the
    // tree paints fully expanded for one frame and the seed then closes every
    // directory that does not have to be open. Asserting before it settles
    // reads the pre-seed tree and every case below looks like the directory
    // failed to collapse. It became visible when the state moved into
    // `folioTreeCollapsedAtom` (feedback #2100), because an atom write is not
    // wrapped by testing-library's `act` the way a `setState` in an effect is.
    //
    // With a folio open inside Framework the seed settles the OTHER way, on
    // purpose: that folio's ancestors are exactly what the seed keeps open.
    // Waiting for the row to disappear there would time out and report the
    // reveal as a failure to collapse.
    await waitFor(() =>
      props.currentFolioId
        ? expect(screen.getByText("Inside A")).not.toBeNull()
        : expect(screen.queryByText("Inside A")).toBeNull(),
    );
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
    const row = label.closest('[data-slot="tree-view-row"]');
    expect(row).not.toBeNull();
    return row as HTMLElement;
  };

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

  /**
   * Feedback #P2134: the empty space under the last row is the largest
   * target in the pane, and it answered a right-click with the browser's own
   * menu.
   *
   * ⚠️ These prove the WIRING, in the same sense the note in `TreeView`'s
   * own rename spec means it: `fireEvent.contextMenu` reaches Base UI's
   * trigger and the portal's items are findable by text, but jsdom lays none
   * of it out, so nothing here says the two menus do not overlap on screen
   * or that the filler is where a pointer would land. The gesture over real
   * geometry is `folio-workspace.spec.ts`.
   */
  describe("the empty space below the rows", () => {
    const emptyArea = (view: { container: HTMLElement }): Element => {
      const area = view.container.querySelector(
        '[data-slot="folio-tree-root-area"]',
      );
      expect(area).not.toBeNull();
      return area!;
    };

    it("offers a folio at the ROOT, not under whatever was selected", async () => {
      // A folio inside Framework is open, so `selectedId` is set and the
      // directory is expanded: the state a menu that inherited a selection
      // would file the new folio into.
      const view = await mount({
        currentFolioId: "33333333-3333-4333-8333-333333333333",
      });

      await act(async () => {
        fireEvent.contextMenu(emptyArea(view));
      });
      await act(async () => {
        fireEvent.click(await screen.findByText("New folio"));
      });

      await waitFor(() =>
        expect(calls.find((c) => c.name === "create")).toBeTruthy(),
      );
      // ⚠️ The assertion is on what was SENT. An omitted `directoryId` is
      // the project root - see `FolioTreeRootContextMenu`'s doc - and the
      // open folio's own directory is what it must not be.
      expect(
        calls.find((c) => c.name === "create")!.input.body.directoryId,
      ).toBeUndefined();
    });

    it("offers a directory at the root the same way", async () => {
      const view = await mount({
        currentFolioId: "33333333-3333-4333-8333-333333333333",
      });

      await act(async () => {
        fireEvent.contextMenu(emptyArea(view));
      });
      await act(async () => {
        fireEvent.click(await screen.findByText("New directory"));
      });

      await waitFor(() =>
        expect(calls.find((c) => c.name === "createDirectory")).toBeTruthy(),
      );
      expect(
        calls.find((c) => c.name === "createDirectory")!.input.body.parentId,
      ).toBeUndefined();
    });

    it("holds two items, and none that need a row", async () => {
      const view = await mount();

      await act(async () => {
        fireEvent.contextMenu(emptyArea(view));
      });

      expect(await screen.findByText("New folio")).toBeTruthy();
      expect(screen.getByText("New directory")).toBeTruthy();
      // Open, rename and delete are all questions about a row, and there is
      // no row here.
      expect(screen.queryByText("Rename")).toBeNull();
      expect(screen.queryByText("Delete")).toBeNull();
    });

    it("leaves a right-click on a ROW to the row's own menu", async () => {
      // Asserted on a FOLIO row, which is the only row whose menu offers no
      // create at all. On a directory both menus carry the same two verbs,
      // so opening both would look exactly like opening the right one.
      //
      // ⚠️ And it does NOT prove the sibling filler was necessary: rebuilt
      // as a wrapper around the whole tree, with the rows inside the
      // trigger, this case still passes - jsdom shows one menu either way.
      // The filler is a structural argument, not one this file can make.
      const view = await mount();
      expect(
        view.container.querySelector('[data-slot="folio-tree-root-area"]'),
      ).not.toBeNull();

      await act(async () => {
        fireEvent.contextMenu(rowFor("At the root"));
      });

      expect(await screen.findByText("Rename")).toBeTruthy();
      expect(screen.queryByText("New directory")).toBeNull();
      expect(screen.queryByText("New folio")).toBeNull();
    });

    it("is not there at all for a reader who may not write", async () => {
      // The rule the header's create buttons already follow: every door to a
      // write asks the same permission, and a menu whose items all answer
      // 403 is worse than the browser's own.
      const view = await mount({}, true);

      expect(
        view.container.querySelector('[data-slot="folio-tree-root-area"]'),
      ).toBeNull();
    });
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
  /*
    Feedback #2114: "we can't close directory when we select a folio inside
    it. I want to be able to close directory, even if I'm selected folio
    inside."

    The reveal effect had `collapsed` in its dependency list, which turned it
    from a RESPONSE TO A NAVIGATION into an INVARIANT - "a selected folio's
    ancestors may never be collapsed". Collapsing the row wrote `collapsed`,
    which re-ran the effect, which deleted the id again, so the row sprang
    back open on every click for as long as that folio stayed selected. An
    invariant cannot be overridden by the person using it, which is the bug.
  */
  describe("the directory holding the open folio", () => {
    const INSIDE_A = "33333333-3333-4333-8333-333333333333";
    const AT_ROOT = "44444444-4444-4444-8444-444444444444";

    it("opens on entry, because the folio inside it is selected", async () => {
      // `mount` waits for exactly this, so the case is a restatement rather
      // than a new assertion - kept so the property is not only an implicit
      // precondition of the three below it.
      await mount({ currentFolioId: INSIDE_A });

      expect(screen.getByText("Inside A")).not.toBeNull();
    });

    it("stays closed once the reader closes it", async () => {
      await mount({ currentFolioId: INSIDE_A });

      await click(rowFor("Framework"));

      // Against the old effect this row is back a tick later, every time.
      expect(screen.queryByText("Inside A")).toBeNull();
    });

    it("does not spring back open on a second attempt either", async () => {
      await mount({ currentFolioId: INSIDE_A });

      await click(rowFor("Framework"));
      await click(rowFor("Framework"));
      await click(rowFor("Framework"));

      expect(screen.queryByText("Inside A")).toBeNull();
    });

    /**
     * ⚠️ The half the fix must NOT take with it. Navigating to another folio
     * is a change of target, so its path is revealed even though the reader
     * had closed that directory while looking at something else.
     */
    it("is revealed again by navigating away and back", async () => {
      const view = await mount({ currentFolioId: INSIDE_A });

      await click(rowFor("Framework"));
      expect(screen.queryByText("Inside A")).toBeNull();

      // To a root-level folio: nothing to reveal, and nothing re-opened.
      view.rerender(
        <AlephaContext.Provider value={alepha!}>
          <DialogProvider>
            <FolioTree
              projectId={1}
              projectSlug="alepha"
              width={260}
              onCollapse={() => {}}
              currentFolioId={AT_ROOT}
            />
          </DialogProvider>
        </AlephaContext.Provider>,
      );
      await waitFor(() => expect(screen.queryByText("Inside A")).toBeNull());

      // ...and back to the one inside the directory.
      await act(async () => {
        view.rerender(
          <AlephaContext.Provider value={alepha!}>
            <DialogProvider>
              <FolioTree
                projectId={1}
                projectSlug="alepha"
                width={260}
                onCollapse={() => {}}
                currentFolioId={INSIDE_A}
              />
            </DialogProvider>
          </AlephaContext.Provider>,
        );
      });

      expect(screen.getByText("Inside A")).not.toBeNull();
    });

    /**
     * ⚠️ The secondary path the fix had to close too: `expandDirIds` is a
     * memo over `nodeById`, which takes a new identity whenever the folio or
     * directory lists change. Before the signature was compared by VALUE, a
     * rename re-fired the reveal and re-opened a directory the reader had
     * just closed.
     */
    it("stays closed when a folio elsewhere is renamed", async () => {
      await mount({ currentFolioId: INSIDE_A });

      await click(rowFor("Framework"));
      expect(screen.queryByText("Inside A")).toBeNull();

      await act(async () => {
        alepha!.store.set(userFoliosAtom, [
          folioOf(INSIDE_A, "Inside A", DIR_A),
          folioOf(AT_ROOT, "Renamed at the root"),
        ] as never);
      });

      expect(screen.queryByText("Inside A")).toBeNull();
      expect(screen.getByText("Renamed at the root")).not.toBeNull();
    });
  });
});
