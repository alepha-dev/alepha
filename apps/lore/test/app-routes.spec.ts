import { Alepha } from "alepha";
import {
  AlephaReactRouter,
  ReactPageProvider,
  ReactRouter,
} from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";

import { insightsDimensionResourceSchema } from "../src/api/schemas/insightsDimensionResourceSchema.ts";
import { ProjectSlugService } from "../src/api/services/ProjectSlugService.ts";
import { ANALYTICS_DIMENSIONS, AppRouter } from "../src/web/app/AppRouter.ts";
import { LoreAccountRouter } from "../src/web/app/components/account/LoreAccountRouter.ts";

/**
 * The route table, pinned by name.
 *
 * `router.path(name)` takes `keyof VirtualRouter<T> | string`, so a name that no
 * longer exists is not a type error anywhere — it widens to the plain `string`
 * overload, the build stays green, and `pathname()` throws the first time a user
 * reaches the call site. That has cost this app a production page more than
 * once: the `ProjectSettings.tsx` nav array below is the one `AppRouter.ts`
 * documents as having taken every settings page down when a route it named was
 * renamed without it.
 *
 * ⚠️ This covers the names the app hands the router **as plain strings** — every
 * `router.path(…)` / `router.push(…)` call and every `route: "…"` nav array in
 * `src/`. It is not a census of the route table: a `$page` nobody navigates to
 * by name is not here, and does not need to be. Regenerate the list with
 *
 *   grep -rhoE 'router\.(path|push|replace|isActive)\(\s*"[a-zA-Z]+"' src/
 *   grep -rn 'route: "' src/
 *
 * and add anything new. A name that appears in a nav array but not here is a
 * route with no guard at all.
 */
const NAV_ROUTE_NAMES = [
  // Sidebar + breadcrumbs — ProjectView.tsx
  "project",
  "projectQuests",
  // Sidebar entry + the view bar's two links — ProjectView.tsx
  "projectKanban",
  // Opening a card — KanbanBoard.tsx
  "projectKanbanCard",
  "projectEpics",
  "projectEpic",
  "projectBlights",
  "projectFeedback",
  "projectReleases",
  // Opening a release from the list — ProjectReleases.tsx
  "projectRelease",
  "projectFolios",
  "projectReports",
  "projectSettingsBanner",
  "projectSettingsSigils",
  "projectSettingsEstates",
  // Apps section + the per-app tab bar — ProjectView.tsx, AppLayout.tsx,
  // ProjectSettingsSigilRow.tsx, AppSettings.tsx
  "projectApps",
  "app",
  "appAnalytics",
  "appAnalyticsDimension",
  "appVitals",
  "appExplore",
  "appArtifacts",
  "appSettings",
  // Settings nav array — ProjectSettings.tsx. This is the array that broke.
  "projectSettingsMembers",
  "projectSettingsAreas",
  "projectSettingsArea",
  "projectSettingsKanban",
  "projectSettingsFolios",
  "projectSettingsFeedback",
  "projectSettingsReleases",
  "projectSettingsQuality",
  "projectSettingsQuests",
  // The bay console's rail — BayLayout.tsx, plus the instance page the Apps
  // entry stays lit for and the drawer's "Open console" link.
  "bay",
  "bayOverview",
  "bayApps",
  "bayApp",
  "bayCommands",
  "baySettings",
  // Reports tab bar — ReportsLayout.tsx
  "reportsOverview",
  "reportsQuests",
  "reportsMembers",
  "reportsQuality",
  // Folios — FolioBrowser / the folio workspace
  "projectFoliosNew",
  "projectFoliosFolio",
  // Quests
  "projectQuest",
  "projectQuestGraph",
  // Outside a project
  "home",
  "login",
  "register",
  "projectCreate",
  "projectFeedbackRequest",
  // The shared /account area (@alepha/ui AccountRouter) plus Lore's own three
  // pages inside it. `myFeedback` kept its pre-migration name on purpose —
  // see LoreAccountRouter.
  "account",
  "accountProfile",
  "accountConnections",
  "accountInvitations",
  "accountProjects",
  "accountEstates",
  "myFeedback",
];

describe("AppRouter route table", () => {
  let alepha: Alepha;
  let router: ReactRouter<AppRouter>;
  let slugs: ProjectSlugService;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    alepha.with(AlephaReactRouter);
    alepha.inject(AppRouter);
    // Registered alongside AppRouter by `LoreWebApp`. Without it the guard
    // would silently skip Lore's own /account pages.
    alepha.inject(LoreAccountRouter);
    // Injected before `start()` — the container locks afterwards.
    slugs = alepha.inject(ProjectSlugService);
    router = alepha.inject(ReactRouter);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  // ⚠️ Two segments since Apps v3, and the app half deliberately CONTAINS a
  // hyphen: `club-b14` + `production` and `club` + `b14-production` are two
  // legal rows that a joined slug would render identically, which is why the
  // route never joined them.
  const app = "club-b14";
  const env = "production";

  it("resolves the per-instance page and each of its tabs", ({ expect }) => {
    const params = { projectSlug: "sds", app, env };

    expect(router.path("projectApps", { params })).toBe("/sds/apps");
    expect(router.path("app", { params })).toBe(`/sds/apps/${app}/${env}/`);
    expect(router.path("projectAppRedirect", { params })).toBe(
      `/sds/apps/${app}`,
    );
    expect(router.path("appAnalytics", { params })).toBe(
      `/sds/apps/${app}/${env}/analytics`,
    );
    expect(router.path("appVitals", { params })).toBe(
      `/sds/apps/${app}/${env}/vitals`,
    );
    // ⚠️ `:analyticsDimension`, not `:dimension`: the router keeps one key per
    // path position, so two routes naming the same position differently
    // collapse onto one and the inner value arrives missing. This resolving to
    // a full path with nothing unsubstituted is what proves it did not. The
    // same rule is why the two segments above are `:app` and `:env`.
    expect(
      router.path("appAnalyticsDimension", {
        params: { ...params, analyticsDimension: "path" },
      }),
    ).toBe(`/sds/apps/${app}/${env}/analytics/path`);
    expect(router.path("appExplore", { params })).toBe(
      `/sds/apps/${app}/${env}/explore`,
    );
    expect(router.path("appArtifacts", { params })).toBe(
      `/sds/apps/${app}/${env}/artifacts`,
    );
    expect(router.path("appSettings", { params })).toBe(
      `/sds/apps/${app}/${env}/settings`,
    );
  });

  it("puts quests under /quests and drops the /p prefix", ({ expect }) => {
    const params = { projectSlug: "sds", shortId: "19" };

    expect(router.path("project", { params })).toBe("/sds");
    expect(router.path("projectQuest", { params })).toBe("/sds/quests/19");
    expect(router.path("projectQuestGraph", { params })).toBe(
      "/sds/quests/19/graph",
    );
    expect(router.path("projectFeedbackRequest", { params })).toBe(
      "/sds/request",
    );
  });

  /**
   * The dimension segment is user input on its way to a query, so the route
   * validates it before anything else sees it. That check is a list, and a
   * list beside an enum is a list that drifts: a seventh leaderboard added to
   * the endpoint and not here would 404 for no visible reason, and one removed
   * from the endpoint and not here would reach it and 400.
   */
  it("validates the dimension segment against exactly what the endpoint takes", ({
    expect,
  }) => {
    expect([...ANALYTICS_DIMENSIONS].sort()).toEqual(
      [...insightsDimensionResourceSchema.shape.dimension.options].sort(),
    );
  });

  it("resolves every name the navs pass as a plain string", ({ expect }) => {
    // A superset of the params any of these routes declares, so a surviving
    // `:segment` in the result means the route's shape changed — not that this
    // test forgot to supply something.
    const params = {
      projectSlug: "sds",
      app,
      env,
      shortId: "3",
      epicNumber: "7",
      releaseTag: "0.28.0",
      areaId: 1,
      analyticsDimension: "path",
      estateId: "b0a1c2d3-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    };

    for (const name of NAV_ROUTE_NAMES) {
      const path = router.path(name, { params });
      expect(path, `${name} should resolve`).toBeTruthy();
      expect(path, `${name} left an unresolved param`).not.toContain(":");
    }
  });

  /**
   * The invariant a root-level `/:projectSlug` creates.
   *
   * Every static first segment in the route table is a name a project could
   * otherwise claim as its slug — `ProjectSlugService.reserved` is what stops
   * that. Adding a root route later without adding its segment there lets a
   * project shadow it: the router tries static children first, so the ROUTE
   * still wins and it is the project that becomes unreachable, silently, for
   * whoever picked that name.
   *
   * This resolves the real route table rather than restating it, so a new
   * root-level page fails here rather than in production.
   */
  it("reserves every static root segment against project slugs", ({
    expect,
  }) => {
    const pageApi = alepha.inject(ReactPageProvider);
    const params = { projectSlug: "sds", app, env, shortId: "3" };

    const unreserved = new Set<string>();
    for (const page of pageApi.getPages()) {
      const path = pageApi.pathname(page.name, { params });
      const first = path.split("/").find(Boolean);
      // Skip the project subtree itself (it resolves to the sample slug) and
      // the wildcard catch-all.
      if (!first || first === "sds" || first.startsWith("*")) {
        continue;
      }
      if (!slugs.isReserved(first)) {
        unreserved.add(first);
      }
    }

    expect(
      [...unreserved].sort(),
      "add these to ProjectSlugService.reserved, or a project can claim them",
    ).toEqual([]);

    // The locale prefixes are root segments too: `routing = "prefix"` makes
    // `/fr/...` the French site, so a project slugged "fr" was swallowed by
    // the locale detection and never reached the project route.
    for (const locale of ["fr", "en"]) {
      expect(slugs.isReserved(locale), locale).toBe(true);
    }
  });

  it("has no project-level Insights route left", ({ expect }) => {
    // Deleted in favour of the per-app tabs. If it comes back, it needs a nav
    // entry too — an orphan route is how the last one rotted. Matched on the
    // message so an unrelated failure cannot pass for this one.
    expect(() => router.path("projectInsights", { params: {} })).toThrow(
      /not found/i,
    );
  });
});
