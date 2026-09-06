import { Alepha, AlephaError } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";
import { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

/**
 * The route loaders that 404 under a disabled capability.
 *
 * **404, never 403, and never a redirect.** A page under a capability the
 * project does not have is a page that does not exist; the API answers 400 for
 * the same state, because a write into one is a request the project
 * understands and declines. Two different questions, two codes, and the split
 * was in the tree before this epic without ever being written down.
 *
 * ⚠️ **A CAPABILITY guards its routes; an OPTION does not.** That is the whole
 * rule, and the asymmetry it produces is a decision rather than an omission,
 * which is why the last case pins it. Each capability's landing route refuses
 * (`/quests`, `/folios`, `/apps` and its tabs, `/feedback`), while
 * `projectEpics`, the board, releases and the roadmap have no loader guard at
 * all: those hang off options inside Work, `projectKanban` set the rule that a
 * saved link keeps resolving, and the sidebar is what stops offering them. A
 * future session will be tempted to make the set uniform in one direction or
 * the other; both cases below say which.
 */
describe("route guards on a capability", () => {
  /**
   * ⚠️ A NODE spec, though it boots the router - and it has to be. As a
   * `.browser.spec.tsx` it ran under jsdom, where a booted router keeps React
   * work scheduled past the point jsdom tears its `window` down: every case
   * passed and the run failed anyway, on an uncaught
   * `ReferenceError: window is not defined` attributed to whichever file went
   * next. Nothing here renders, so there was never a reason to be there.
   * `app-routes.spec.ts` boots the same router from the same place.
   *
   * Containers are stopped in an `afterEach` regardless.
   */
  const containers: Alepha[] = [];

  afterEach(async () => {
    await Promise.all(containers.splice(0).map((it) => it.stop()));
  });

  const bootRouter = async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AppRouter);
    await alepha.start();
    containers.push(alepha);
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

  it("404s each capability's own landing route", async ({ expect }) => {
    const alepha = await bootRouter();
    // Apps only. Every other capability's landing route is a page this
    // project does not have.
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities: ["apps"] }) as never,
    );

    for (const name of ["projectQuests", "projectFolios", "projectFeedback"]) {
      const loader = loaderOf(alepha, name);
      await expect(loader?.({} as never), name).rejects.toThrow(/not enabled/i);
    }
  });

  it("lets /quests through once Work is on", async ({ expect }) => {
    const alepha = await bootRouter();
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities: ["work"] }) as never,
    );

    // The pair again: `projectQuests`'s loader fetches nothing, so a guard
    // that refused everything would look identical from the case above.
    await expect(
      loaderOf(alepha, "projectQuests")?.({} as never),
    ).resolves.toBeUndefined();
  });

  it("leaves the epic, board and release routes unguarded", async ({
    expect,
  }) => {
    const alepha = await bootRouter();

    // No loader at all on these three, though `board`, `epics` and
    // `releases` are all switches somebody can turn off. They are OPTIONS
    // inside Work, and an option does not make a page stop existing: a link
    // somebody saved keeps resolving, and the sidebar is what stops offering
    // it. `/quests` above is the capability, and it does refuse.
    for (const name of ["projectEpics", "projectKanban", "projectReleases"]) {
      expect(loaderOf(alepha, name), name).toBeUndefined();
    }
  });
});
