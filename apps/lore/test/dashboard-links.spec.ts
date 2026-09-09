import { Alepha } from "alepha";
import { AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DashboardMetricCatalog } from "@/api/services/DashboardMetricCatalog.ts";
import { AppRouter } from "@/web/app/AppRouter.ts";

/**
 * Every drill-through in the metric catalogue lands on a route that exists.
 *
 * `DashboardMetricCatalog.link()` names routes as plain strings, because the
 * catalogue has to stay importable by the browser AND resolvable on the
 * server, and `AppRouter` is a browser module. Plain strings are exactly the
 * shape `apps/lore/CLAUDE.md` warns about: `router.path(name)` widens an
 * unknown name to the `string` overload, so a `$page` rename keeps the build
 * green and throws the first time a reader clicks the tile.
 *
 * This is the guard. Same job as `app-routes.spec.ts`, for the one place
 * route names live outside `src/web`.
 */
describe("dashboard drill-through links", () => {
  let alepha: Alepha;
  let router: ReactRouter<AppRouter>;
  let catalog: DashboardMetricCatalog;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } });
    alepha.with(AlephaReactRouter);
    alepha.inject(AppRouter);
    catalog = alepha.inject(DashboardMetricCatalog);
    router = alepha.inject(ReactRouter);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  /**
   * Every param any catalogue link can ask for, so `path()` can build one.
   *
   * ⚠️ `epicNumber` is the epic's PER-PROJECT number, not its row id, and it
   * reaches `link()` through `DashboardCardTarget` because the stored scope
   * carries the id and `/epics/:epicNumber` takes the other one.
   */
  const params = {
    projectSlug: "sds",
    appName: "docs",
    epicNumber: "46",
    releaseTag: "0.28.0",
    tag: "need-answer",
  };

  it("resolves every metric's link to a real path", ({ expect }) => {
    // A guard that silently checks nothing is worse than no guard.
    expect(catalog.all().length).toBeGreaterThan(0);

    for (const metric of catalog.all()) {
      const link = metric.link(
        { kind: "all" },
        {
          projectSlug: params.projectSlug,
          appName: params.appName,
          epicNumber: Number(params.epicNumber),
          releaseTag: params.releaseTag,
          tag: params.tag,
        },
      );
      expect(link, `metric '${metric.key}' produced no link`).toBeDefined();
      expect(
        router.path(link!.route, { params, query: link!.query }),
        `metric '${metric.key}' names a route that does not resolve`,
      ).toMatch(/^\/sds/);
    }
  });

  it("sends the active-quests tile to status=new, not to its own filter", ({
    expect,
  }) => {
    // The count is `new + accepted`; the link is `new` only, because the
    // questlog rail already shows the accepted ones. This divergence is the
    // reason `link()` is a declared function rather than a translation of the
    // filter — if someone "fixes" it, this fails.
    const link = catalog
      .get("activeQuests")
      .link({ kind: "all" }, { projectSlug: "sds" });

    expect(link).toEqual({
      route: "projectQuests",
      params: { projectSlug: "sds" },
      query: { status: "new" },
    });
    // `/quests`, not `/`: the quest list moved off the project root when
    // Activity took it. The tile still names its destination by ROUTE, which
    // is why the move needed no change to the catalog — only to this
    // assertion, which is the one place the path is spelled out.
    expect(router.path(link!.route, { params, query: link!.query })).toBe(
      "/sds/quests?status=new",
    );
  });

  it("addresses an epic by its number and never by its row id", ({
    expect,
  }) => {
    // The trap #Q2140 exists for: the scope stores `epicId`, the route takes
    // `epicNumber`, and both are integers. A card that shipped the id would
    // land on a real page showing somebody else's epic, silently.
    const link = catalog
      .get("epicProgress")
      .link(
        { kind: "epic", epicId: 981 },
        { projectSlug: "sds", epicNumber: 46 },
      );

    expect(link).toEqual({
      route: "projectEpic",
      params: { projectSlug: "sds", epicNumber: "46" },
    });
    expect(router.path(link!.route, { params: link!.params })).toBe(
      "/sds/epics/46",
    );
  });

  it("addresses a release by its tag, never by its row id", ({ expect }) => {
    const link = catalog
      .get("releaseProgress")
      .link(
        { kind: "release", releaseId: 12 },
        { projectSlug: "sds", releaseTag: "0.28.0" },
      );

    expect(link).toEqual({
      route: "projectRelease",
      params: { projectSlug: "sds", releaseTag: "0.28.0" },
    });
    expect(router.path(link!.route, { params: link!.params })).toBe(
      "/sds/releases/0.28.0",
    );
  });

  it("opens the tag card on the OPEN half of its own tag", ({ expect }) => {
    const link = catalog
      .get("tagCompletion")
      .link(
        { kind: "projects", projectIds: [1] },
        { projectSlug: "sds", tag: "need-answer" },
      );

    // ⚠️ Deliberately disagrees with the count, like the active-quests tile:
    // the number is a completion ratio, so the useful thing to open is what
    // is LEFT rather than what is finished.
    expect(link).toEqual({
      route: "projectQuests",
      params: { projectSlug: "sds" },
      query: { tag: "need-answer", status: "new,accepted" },
    });
    expect(router.path(link!.route, { params, query: link!.query })).toBe(
      "/sds/quests?tag=need-answer&status=new%2Caccepted",
    );
  });

  it("gives no link at all when the target does not exist", ({ expect }) => {
    // Better no link than a 404. The visitors tile needs an app name, and a
    // project with no beacon-carrying app cannot supply one.
    expect(
      catalog
        .get("uniqueVisitors")
        .link({ kind: "all" }, { projectSlug: "sds" }),
    ).toBeUndefined();
    expect(
      catalog.get("activeQuests").link({ kind: "all" }, {}),
    ).toBeUndefined();
    // An epic card with no number resolved is the same rule: better no link
    // than one built with `undefined` in the path.
    expect(
      catalog
        .get("epicProgress")
        .link({ kind: "epic", epicId: 1 }, { projectSlug: "sds" }),
    ).toBeUndefined();
    // `releases.tag` is optional at the column, so this is a real state and
    // not a defensive branch: better no link than `/releases/undefined`.
    expect(
      catalog
        .get("releaseProgress")
        .link({ kind: "release", releaseId: 1 }, { projectSlug: "sds" }),
    ).toBeUndefined();
  });
});
