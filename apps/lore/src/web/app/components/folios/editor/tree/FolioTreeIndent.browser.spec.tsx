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

const DIR = (n: number) => `${n}${"1".repeat(7)}-1111-4111-8111-111111111111`;

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
 * Where the indent guides are painted (feedback #2108).
 *
 * The guides used to start at the row's own base padding, which put every one
 * of them 7px to the LEFT of the chevron it marks, at every depth. The fix is
 * arithmetic on two inline styles, so jsdom is the right place to pin it: the
 * relationship between `paddingLeft`, `backgroundPosition` and the width of
 * the disclosure column is exactly what a browser would be measuring anyway,
 * and here it can be checked at three depths at once without a screenshot.
 *
 * The rule, stated once: a guide is centred on the disclosure column of the
 * level it marks. Everything below is that sentence in numbers.
 */
describe("FolioTree indent guides", () => {
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
    shortId: 1,
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

    // Three nested directories, so the offset has three chances to repeat.
    alepha.store.set(projectDirectoriesAtom, [
      { id: DIR(1), shortId: 1, name: "Level0" },
      { id: DIR(2), shortId: 2, name: "Level1", parentId: DIR(1) },
      { id: DIR(3), shortId: 3, name: "Level2", parentId: DIR(2) },
    ] as never);
    alepha.store.set(userFoliosAtom, [
      folioOf("44444444-4444-4444-8444-444444444444", "Leaf", DIR(3)),
    ] as never);

    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <FolioTree projectId={1} projectSlug="alepha" width={260} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("Level0");
    // ⚠️ Wait for the collapse SEED, which is an effect: the tree paints
    // fully expanded for one frame and then closes every directory. Measuring
    // before it settles reads the pre-seed tree.
    await waitFor(() => expect(screen.queryByText("Level1")).toBeNull());

    // Open all three, so there is a row at every depth to measure.
    for (const name of ["Level0", "Level1", "Level2"]) {
      const chevron = rowOf(name).querySelector("button");
      expect(chevron, `chevron for ${name}`).toBeTruthy();
      // `act` rather than `waitFor`: collapse state lives in an atom, and an
      // atom write is not wrapped the way a `setState` is, so a bare
      // `fireEvent` leaves the re-render unflushed.
      await act(async () => {
        fireEvent.click(chevron!);
      });
    }
    await screen.findByText("Leaf");
  };

  /**
   * The row element carrying the inline styles - the same node the guides are
   * painted on. Found from its label rather than by index, so a change to the
   * tree's ordering fails somewhere honest instead of here.
   */
  const rowOf = (label: string): HTMLElement => {
    const row = screen
      .getByText(label)
      .closest('[data-slot="folio-tree-row"]') as HTMLElement | null;
    expect(row, `row for ${label}`).not.toBeNull();
    return row as HTMLElement;
  };

  const px = (value: string): number => Number.parseFloat(value || "0");

  it("centres each guide on the disclosure column it marks", async () => {
    await mount();

    // The disclosure column's width comes from the same constant as the
    // guide origin, which is why it is an inline style and not `w-3.5`: a
    // class here would let the box be resized while the guides stayed put.
    const box = px(
      (rowOf("Level0").querySelector("button") as HTMLElement).style.width,
    );
    expect(box, "the disclosure column's width").toBe(14);

    const base = px(rowOf("Level0").style.paddingLeft);
    // Depth 0 keeps the row's own base padding. If this moved, the fix
    // shifted content rather than the guide, which is the failure the quest
    // is specifically about.
    expect(base, "a depth-0 row's padding is untouched").toBe(8);

    const expectedOrigin = base + box / 2;

    for (const [depth, label] of [
      [1, "Level1"],
      [2, "Level2"],
      [3, "Leaf"],
    ] as const) {
      const row = rowOf(label);
      const padding = px(row.style.paddingLeft);
      const [originX] = row.style.backgroundPosition.split(" ");

      // The step is unchanged, so content sits exactly where it did.
      expect(padding, `depth ${depth} padding`).toBe(8 + depth * 13);

      // Every depth paints from the SAME origin - the guides repeat, they do
      // not restart per row - and that origin is the centre of a depth-0
      // disclosure column.
      expect(px(originX), `depth ${depth} guide origin`).toBe(expectedOrigin);

      // Which is what makes the k-th line land on the k-th ancestor's
      // chevron: origin + k*step === (8 + k*step) + box/2, for every k.
      for (let k = 0; k < depth; k++) {
        expect(
          px(originX) + k * 13,
          `guide ${k} under a depth-${depth} row`,
        ).toBe(8 + k * 13 + box / 2);
      }
    }
  });
});
