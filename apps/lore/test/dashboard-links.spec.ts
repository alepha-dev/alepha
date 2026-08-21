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

  /** Every param any catalogue link can ask for, so `path()` can build one. */
  const params = { projectSlug: "sds", appName: "docs" };

  it("resolves every metric's link to a real path", ({ expect }) => {
    // A guard that silently checks nothing is worse than no guard.
    expect(catalog.all().length).toBeGreaterThan(0);

    for (const metric of catalog.all()) {
      const link = metric.link(
        { kind: "all" },
        { projectSlug: params.projectSlug, appName: params.appName },
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
    expect(router.path(link!.route, { params, query: link!.query })).toBe(
      "/sds/?status=new",
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
  });
});
