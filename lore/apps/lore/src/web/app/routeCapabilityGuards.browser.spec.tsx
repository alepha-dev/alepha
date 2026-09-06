import { Alepha, AlephaError } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";

import { AppRouter } from "./AppRouter.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";

/**
 * The route loaders that 404 under a disabled capability.
 *
 * **404, never 403, and never a redirect.** A page under a capability the
 * project does not have is a page that does not exist; the API answers 400 for
 * the same state, because a write into one is a request the project
 * understands and declines. Two different questions, two codes, and the split
 * was in the tree before this epic without ever being written down.
 *
 * ⚠️ The second case is the one worth keeping. `projectEpics`, the board,
 * releases and the roadmap have NO loader guard, deliberately: `projectKanban`
 * set the rule that a saved link keeps resolving and the sidebar decides what
 * is offered. A future session reading the four Apps guards here will be
 * tempted to make the set uniform, and this asserts the asymmetry is a
 * decision rather than an omission.
 */
describe("route guards on a capability", () => {
  const bootRouter = async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AppRouter);
    await alepha.start();
    return alepha;
  };

  const loaderOf = (alepha: Alepha, name: string) => {
    const page = [...alepha.primitives($page)].find((it) => it.name === name);
    if (!page) throw new AlephaError(`AppRouter no longer declares ${name}`);
    return page.options.loader;
  };

  it("404s /apps on a project without the Apps capability", async ({
    expect,
  }) => {
    const alepha = await bootRouter();
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities: ["work", "knowledge"] }) as never,
    );

    const loader = loaderOf(alepha, "projectApps");
    await expect(loader?.({} as never)).rejects.toThrow(/not enabled/i);
  });

  it("lets the same URL through once Apps is on", async ({ expect }) => {
    const alepha = await bootRouter();
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities: ["knowledge", "apps"] }) as never,
    );

    const loader = loaderOf(alepha, "projectApps");
    // Resolves rather than throws. The pair matters: a guard that refused
    // everything would satisfy the case above on its own.
    await expect(loader?.({} as never)).resolves.toBeUndefined();
  });

  it("leaves the epic, board and release routes unguarded", async ({
    expect,
  }) => {
    const alepha = await bootRouter();

    // No loader at all on these three. A link somebody saved keeps resolving
    // whatever the options say; the sidebar is what stops offering them.
    for (const name of ["projectEpics", "projectKanban", "projectReleases"]) {
      expect(loaderOf(alepha, name), name).toBeUndefined();
    }
  });
});
