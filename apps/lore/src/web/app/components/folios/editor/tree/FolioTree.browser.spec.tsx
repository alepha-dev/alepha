import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <FolioTree projectId={1} projectSlug="alepha" width={260} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("Framework");
    return view;
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

    fireEvent.click(rowFor("Framework"));

    // No `waitFor` and no fake timers on purpose: the child has to be there
    // in the same tick the click was handled. Before this change the assert
    // below failed and only a 250ms wait made it pass.
    expect(screen.getByText("Inside A")).not.toBeNull();
  });

  it("collapses again on the next click", async () => {
    await mount();

    fireEvent.click(rowFor("Framework"));
    expect(screen.getByText("Inside A")).not.toBeNull();

    fireEvent.click(rowFor("Framework"));
    expect(screen.queryByText("Inside A")).toBeNull();
  });

  /**
   * The gesture the 250ms defer existed to protect. It still works, and the
   * directory ends where it started: the first click of the burst toggled
   * it, and `handleDoubleClick` toggles it back.
   */
  it("still opens the inline rename on a double click, leaving the directory as it was", async () => {
    const view = await mount();

    const row = rowFor("Framework");
    fireEvent.click(row, { detail: 1 });
    fireEvent.doubleClick(row);

    await waitFor(() =>
      expect(view.container.querySelector("input")).not.toBeNull(),
    );
    // Reverted: opened by the first click, closed again by the second.
    expect(screen.queryByText("Inside A")).toBeNull();
  });

  it("marks the chevron and the row as separate targets, so the chevron still toggles", async () => {
    await mount();

    const row = rowFor("Framework");
    const chevron = row.querySelector("button");
    expect(chevron).not.toBeNull();

    fireEvent.click(chevron!);
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

    fireEvent.click(rowFor("Framework"));

    const nested = rowFor("Inside A");
    expect(nested.style.backgroundImage).toContain("repeating-linear-gradient");
    // The guide is painted from the theme's border token, never a literal.
    expect(nested.style.backgroundImage).toContain("var(--border)");
  });
});
