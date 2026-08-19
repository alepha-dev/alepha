import { Alepha } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { LoreAdminRouter } from "./LoreAdminRouter.tsx";

/**
 * Lore is the second consumer of `@alepha/ui`'s admin shell, and the one that
 * auto-deploys from `main` — so the band that keeps an application's own group
 * ahead of the framework's is asserted here as well as in the framework.
 *
 * The group order is recomputed the way `useNavEntries` does it (a group sorts
 * by its smallest member) rather than by reading the numbers back, so this
 * fails if either side of the arrangement moves: Lore drifting above 1000, or
 * a built-in dropping below it.
 */
describe("LoreAdminRouter", () => {
  it("leads the admin sidebar, ahead of the framework's own groups", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    // Declaring a page with `$pageAdmin` registers `AdminRouter` and its
    // built-ins — that side effect is what puts three groups in this table.
    alepha.inject(LoreAdminRouter);
    await alepha.start();

    const smallest = new Map<string, number>();
    for (const page of alepha.primitives($page)) {
      const nav = page.options.nav;
      if (!nav?.group) continue;
      const order = nav.order ?? 0;
      const prev = smallest.get(nav.group);
      if (prev === undefined || order < prev) smallest.set(nav.group, order);
    }

    const groups = [...smallest.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([group]) => group);

    expect(groups).toEqual(["Lore", "Identity", "System"]);
  });
});
