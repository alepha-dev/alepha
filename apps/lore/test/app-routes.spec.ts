import { Alepha } from "alepha";
import { AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";
import { AppRouter } from "../src/web/app/AppRouter.ts";

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
  "projectBlights",
  "projectFeedback",
  "projectMilestones",
  "projectFolios",
  "projectReports",
  "projectSettingsBanner",
  "projectSettingsSigils",
  // Apps section + the per-app tab bar — ProjectView.tsx, AppLayout.tsx,
  // ProjectSettingsSigilRow.tsx, AppSettings.tsx
  "app",
  "appAnalytics",
  "appPerformance",
  "appErrors",
  "appSettings",
  // Settings nav array — ProjectSettings.tsx. This is the array that broke.
  "projectSettingsMembers",
  "projectSettingsZones",
  "projectSettingsKanban",
  "projectSettingsFolios",
  "projectSettingsFeedback",
  "projectSettingsMilestones",
  "projectSettingsQuests",
  // Reports tab bar — ReportsLayout.tsx
  "reportsOverview",
  "reportsQuests",
  "reportsMembers",
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
  "me",
  "connections",
];

describe("AppRouter route table", () => {
  let alepha: Alepha;
  let router: ReactRouter<AppRouter>;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    alepha.with(AlephaReactRouter);
    alepha.inject(AppRouter);
    router = alepha.inject(ReactRouter);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const appName = "lore-staging";

  it("resolves the per-app page and each of its tabs", ({ expect }) => {
    const params = { projectId: "7", appName };

    expect(router.path("app", { params })).toBe(`/p/7/apps/${appName}/`);
    expect(router.path("appAnalytics", { params })).toBe(
      `/p/7/apps/${appName}/analytics`,
    );
    expect(router.path("appPerformance", { params })).toBe(
      `/p/7/apps/${appName}/performance`,
    );
    expect(router.path("appErrors", { params })).toBe(
      `/p/7/apps/${appName}/errors`,
    );
    expect(router.path("appSettings", { params })).toBe(
      `/p/7/apps/${appName}/settings`,
    );
  });

  it("resolves every name the navs pass as a plain string", ({ expect }) => {
    // A superset of the params any of these routes declares, so a surviving
    // `:segment` in the result means the route's shape changed — not that this
    // test forgot to supply something.
    const params = { projectId: "7", appName, shortId: "3" };

    for (const name of NAV_ROUTE_NAMES) {
      const path = router.path(name, { params });
      expect(path, `${name} should resolve`).toBeTruthy();
      expect(path, `${name} left an unresolved param`).not.toContain(":");
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
