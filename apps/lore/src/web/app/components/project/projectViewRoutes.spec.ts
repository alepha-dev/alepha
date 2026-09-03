import { Alepha, AlephaError } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";

import { AppRouter } from "../../AppRouter.ts";
import {
  ROUTES_APP,
  ROUTES_FULL_WIDTH,
  SECTION_HREF_ROUTES,
  SECTION_LABEL_KEYS,
} from "./projectViewRoutes.ts";

/**
 * Route names are plain strings, so a tab added to `AppRouter` and to
 * `AppLayout` but not to the shell's route tables is not a compile error. It
 * is a page in the centred column while its siblings run full width, a
 * sidebar that no longer highlights the open app, and an "Apps" crumb that
 * goes dead. The Explore tab shipped exactly that way (quest #1689).
 *
 * The names are read off the router rather than listed here: a list in the
 * spec would be one more copy of the same strings, and the point is that the
 * router stays the only copy anyone has to edit.
 */
describe("projectViewRoutes", () => {
  /**
   * A shell route's own name plus the names of every tab declared under it,
   * read off the real router. Listing them here instead would be one more
   * copy of the same strings, and the point is that the router stays the only
   * copy anyone has to edit.
   */
  const pageNamesUnder = async (shell: string): Promise<string[]> => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AppRouter);
    await alepha.start();

    const pages = [...alepha.primitives($page)];
    const parent = pages.find((it) => it.name === shell);
    if (!parent) {
      throw new AlephaError(`AppRouter no longer declares a ${shell} page`);
    }
    const children = parent.options.children ?? [];
    const tabs = typeof children === "function" ? children() : children;
    return [parent.name, ...tabs.map((it) => it.name)];
  };

  it("registers the per-app page and every tab under it", async () => {
    const names = await pageNamesUnder("projectApp");

    // The tab that shipped half-registered. Delete this line only when the
    // tab itself leaves the router.
    expect(names).toContain("appExplore");

    for (const name of names) {
      expect(ROUTES_APP.has(name), `${name} is missing from ROUTES_APP`).toBe(
        true,
      );
      expect(
        ROUTES_FULL_WIDTH.has(name),
        `${name} is missing from ROUTES_FULL_WIDTH`,
      ).toBe(true);
      expect(
        SECTION_HREF_ROUTES[name],
        `${name} has no Apps crumb in SECTION_HREF_ROUTES`,
      ).toBe("projectApps");
      expect(
        SECTION_LABEL_KEYS[name],
        `${name} has no section label in SECTION_LABEL_KEYS`,
      ).toBe("project.menu.apps");
    }
  });

  /**
   * Reports is the same trap one page over, and it fell into it (#1748, from
   * feedback #2079: "It must be 100% width, 100% height, and scroll only the
   * content of the page"). It has been on `PlateLayout` since #1693 - a
   * full-width plate over tabs that owns its own scroll - while none of its
   * five route names was in `ROUTES_FULL_WIDTH`, so `ProjectView` capped it at
   * `max-w-5xl` and left the OUTER container on `overflow-auto`: the plate sat
   * in a centred column and the whole page scrolled under it.
   *
   * `ProjectView` only ever reads the active LEAF, so the shell being here is
   * belt and braces - and that is the point, since a set naming four of the
   * five is a trap for whoever adds the sixth.
   */
  it("runs Reports and every tab under it full width", async () => {
    const names = await pageNamesUnder("projectReports");

    // The four that exist today. Not a closed list - the loop below is - but
    // enough that deleting one is a decision rather than an accident.
    expect(names).toEqual(
      expect.arrayContaining([
        "projectReports",
        "reportsOverview",
        "reportsQuests",
        "reportsMembers",
        "reportsQuality",
      ]),
    );

    for (const name of names) {
      expect(
        ROUTES_FULL_WIDTH.has(name),
        `${name} is missing from ROUTES_FULL_WIDTH`,
      ).toBe(true);
    }
  });
});
