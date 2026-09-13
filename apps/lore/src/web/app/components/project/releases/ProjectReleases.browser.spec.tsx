import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectReleases from "./ProjectReleases.tsx";

const RELEASED = "2026-09-03T10:00:00.000Z";

/**
 * A whole release resource: `currentReleasesAtom` is schema-validated, so a
 * fixture carrying only the fields the menu reads would be refused there.
 * `number` is the creation order, so a list reads in the order it was made.
 */
const releaseOf = (
  number: number,
  tag: string,
  options: { released?: boolean; default?: boolean } = {},
): ReleaseResource => ({
  id: number,
  number,
  projectId: 1,
  tag,
  title: tag,
  description: "",
  releasedAt: options.released ? RELEASED : undefined,
  defaultSince: options.default ? RELEASED : undefined,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
});

/**
 * Project 1 when epic #E56 was planned: two releases shipped, `0.30.0` open
 * and the default, and a far-future `1.0.0` planned before `0.29.0` existed.
 */
const PROJECT_1 = [
  releaseOf(1, "0.28.0", { released: true }),
  releaseOf(2, "1.0.0"),
  releaseOf(3, "0.29.0", { released: true }),
  releaseOf(4, "0.30.0", { default: true }),
];

/**
 * Stands in for the HTTP-backed `useClient()` calls the page makes. The seam
 * `ProjectEpics.browser.spec.tsx` uses, with two things that fake has not:
 *
 * - **a call log**, so "never calls `createRelease`" is an assertion about
 *   what happened rather than an absence of evidence;
 * - **a per-action `can`**, so one action can be refused while the rest are
 *   allowed. The Epics fake answers `true` for everything.
 */
class FakeLinkProvider extends LinkProvider {
  releases: ReleaseResource[] = PROJECT_1;
  calls: Array<{ name: string; args: unknown[] }> = [];
  denied = new Set<string>();

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const action = (name: string, fn: (...args: any[]) => Promise<unknown>) =>
      Object.assign(
        async (...args: unknown[]) => {
          this.calls.push({ name, args });
          return await fn(...args);
        },
        { can: () => !this.denied.has(name) },
      );
    return new Proxy({} as Record<string, unknown>, {
      get: (_, prop: string) =>
        prop === "getReleases"
          ? action(prop, async () => [...this.releases])
          : action(prop, async () => ({ ok: true })),
    });
  }

  called(name: string): boolean {
    return this.calls.some((call) => call.name === name);
  }
}

/**
 * The release page, so the tag anchors have something to resolve against.
 */
class Routes {
  release = $page({
    name: "projectRelease",
    path: "/releases/:releaseTag",
    component: () => null,
  });
}

/**
 * The Releases table's row menu and its deletes (epic #E56).
 *
 * `releaseBumps.spec.ts` proves the rule over plain fixtures. This proves the
 * wiring, which is where the menu and the table's own filtering can disagree
 * with the rule: a menu fed from the visible rows passes every pure case and
 * offers a release that already exists the moment a filter is on.
 */
describe("ProjectReleases - the row menu and the deletes", () => {
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
    // The table persists its filters per project; a case must not inherit
    // the previous one's selection.
    localStorage.clear();
  });

  const mount = async (
    options: { releases?: ReleaseResource[]; denied?: string[] } = {},
  ) => {
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

    const releases = options.releases ?? PROJECT_1;
    const fake = alepha.inject(FakeLinkProvider);
    fake.releases = releases;
    for (const name of options.denied ?? []) fake.denied.add(name);

    alepha.store.set(currentProjectAtom, projectFixture() as never);
    alepha.store.set(currentReleasesAtom, releases);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectReleases />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByRole("link", { name: releases[0].tag });
    return fake;
  };

  const rowOf = (tag: string) => {
    const row = screen.getByRole("link", { name: tag }).closest("tr");
    expect(row).not.toBeNull();
    return row!;
  };

  /**
   * Open one row's menu and answer its top-level entries.
   *
   * ⚠️ The three-dots trigger toggles, so a case opens a row's menu once and
   * reuses the list, the way the Epics spec learned to.
   */
  const openRowMenu = async (tag: string) => {
    fireEvent.click(
      within(rowOf(tag)).getByRole("button", { name: "Open row actions" }),
    );
    return await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')];
      if (found.length === 0) throw new Error("not open yet");
      return found;
    });
  };

  /**
   * Every create entry a row offers, flat or inside the Create release
   * group, as the labels a reader sees.
   */
  const createOffers = async (tag: string): Promise<string[]> => {
    const top = await openRowMenu(tag);
    const group = top.find((item) => item.textContent === "Create release");
    if (!group) {
      return top
        .map((item) => item.textContent ?? "")
        .filter((label) => label.startsWith("Create "));
    }
    fireEvent.click(group);
    return await waitFor(() => {
      const labels = [...document.querySelectorAll('[role="menuitem"]')]
        .map((item) => item.textContent ?? "")
        .filter(
          (label) => label.startsWith("Create ") && label !== "Create release",
        );
      if (labels.length === 0) throw new Error("submenu not open yet");
      return labels;
    });
  };

  describe("the create entries", () => {
    it("offers a patch on a published frontier row", async () => {
      await mount();

      expect(await createOffers("0.29.0")).toEqual(["Create 0.29.1"]);
    });

    it("offers no patch on an open frontier row, only its next minor", async () => {
      await mount();

      expect(await createOffers("0.30.0")).toEqual(["Create 0.31.0"]);
    });

    it("groups two or more entries under Create release, patch before major", async () => {
      await mount({ releases: [releaseOf(1, "1.0.0", { released: true })] });

      expect(await createOffers("1.0.0")).toEqual([
        "Create 1.0.1",
        "Create 1.1.0",
        "Create 2.0.0",
      ]);
    });

    it("offers nothing from a row that is no longer the frontier of its line", async () => {
      await mount({
        releases: [
          releaseOf(1, "0.28.0", { released: true }),
          releaseOf(2, "0.28.1", { released: true }),
        ],
      });

      // 0.28.1 took the patch line and the rest of major 0 with it.
      const labels = (await openRowMenu("0.28.0")).map(
        (item) => item.textContent ?? "",
      );
      expect(labels.filter((label) => label.startsWith("Create"))).toEqual([]);
    });

    it("does not move the offers when the table is filtered to Released", async () => {
      await mount();

      const state = screen.getByRole("combobox", { name: "State" });
      fireEvent.keyDown(state, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("option", { name: /Released/ }));
      await waitFor(() =>
        expect(screen.queryByRole("link", { name: "0.30.0" })).toBeNull(),
      );

      // With 0.30.0 filtered out of the ROWS, a menu fed from the rows would
      // take 0.29.0 for the frontier of major 0 and offer 0.30.0, which
      // exists. The menu reads the unfiltered response instead.
      const offers = await createOffers("0.29.0");
      expect(offers).toEqual(["Create 0.29.1"]);
      expect(offers).not.toContain("Create 0.30.0");
    });

    it("opens the create dialog holding the tag, and writes nothing", async () => {
      const fake = await mount();

      const entry = (await openRowMenu("0.30.0")).find(
        (item) => item.textContent === "Create 0.31.0",
      );
      expect(entry).toBeDefined();
      fireEvent.click(entry!);

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("textbox")).toHaveProperty(
        "value",
        "0.31.0",
      );
      expect(fake.called("createRelease")).toBe(false);
    });

    it("seeds the field again on every open: another row, then the toolbar", async () => {
      await mount();

      const field = () =>
        within(screen.getByRole("dialog")).getByRole("textbox");
      const cancel = async () => {
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: "Cancel",
          }),
        );
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      };

      fireEvent.click(
        (await openRowMenu("0.30.0")).find(
          (item) => item.textContent === "Create 0.31.0",
        )!,
      );
      await screen.findByRole("dialog");
      expect(field()).toHaveProperty("value", "0.31.0");
      // Typed over, then abandoned: the next open must not inherit it.
      fireEvent.change(field(), { target: { value: "0.31.0-typed" } });
      await cancel();

      await createOffers("1.0.0");
      fireEvent.click(
        [...document.querySelectorAll('[role="menuitem"]')].find(
          (item) => item.textContent === "Create 2.0.0",
        )!,
      );
      await screen.findByRole("dialog");
      expect(field()).toHaveProperty("value", "2.0.0");
      await cancel();

      fireEvent.click(screen.getByRole("button", { name: "New Release" }));
      await screen.findByRole("dialog");
      expect(field()).toHaveProperty("value", "");
      // The toolbar's door suggests rather than fills: 0.29.0 is the highest
      // shipped release, and the frontier of its major is 0.30.0.
      expect(field()).toHaveProperty("placeholder", "0.31.0");
    });

    it("offers no create entry when createRelease is refused", async () => {
      await mount({ denied: ["createRelease"] });

      const labels = (await openRowMenu("1.0.0")).map(
        (item) => item.textContent ?? "",
      );
      expect(labels.filter((label) => label.startsWith("Create"))).toEqual([]);
    });
  });

  describe("delete", () => {
    /**
     * Open the row's Delete, and answer the confirm it raised.
     */
    const askToDelete = async (tag: string) => {
      const entry = (await openRowMenu(tag)).find(
        (item) => item.textContent === "Delete",
      );
      expect(entry).toBeDefined();
      fireEvent.click(entry!);
      return await screen.findByRole("alertdialog");
    };

    const PUBLISHED = /frozen changelog/;
    const DEFAULT = /left with none/;

    it("asks first, and dismissing the confirm deletes nothing", async () => {
      const fake = await mount();

      const confirm = await askToDelete("1.0.0");
      expect(confirm.textContent).toContain("detached");
      fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(fake.called("deleteRelease")).toBe(false);
    });

    it("names the frozen record on a published release, and nothing about the default", async () => {
      await mount();

      const text = (await askToDelete("0.29.0")).textContent ?? "";
      expect(text).toMatch(PUBLISHED);
      expect(text).not.toMatch(DEFAULT);
    });

    it("names the lost default on the default release, and nothing about a record", async () => {
      await mount();

      const text = (await askToDelete("0.30.0")).textContent ?? "";
      expect(text).toMatch(DEFAULT);
      expect(text).not.toMatch(PUBLISHED);
    });

    it("says neither on an open release that is not the default", async () => {
      await mount();

      const text = (await askToDelete("1.0.0")).textContent ?? "";
      expect(text).not.toMatch(PUBLISHED);
      expect(text).not.toMatch(DEFAULT);
    });

    it("offers no checkbox and no Delete entry when deleteRelease is refused", async () => {
      await mount({ denied: ["deleteRelease"] });

      // The checkbox column exists only because `bulkActions` is non-empty,
      // and Delete is its only entry.
      expect(screen.queryAllByRole("checkbox")).toEqual([]);
      const labels = (await openRowMenu("1.0.0")).map(
        (item) => item.textContent ?? "",
      );
      expect(labels).not.toContain("Delete");
    });
  });
});
