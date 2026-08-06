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
 * once (the 2026-08 rename, and the Kanban route before it).
 *
 * This is the guard: every name the app navigates to by string, resolved
 * through the real router, plus the shape of the paths those names produce.
 */
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

  const sigilId = "3f1d6f6a-06d5-4a1f-9a1a-2b3c4d5e6f70";

  it("resolves the per-app page and each of its tabs", ({ expect }) => {
    const params = { projectId: "7", sigilId };

    expect(router.path("app", { params })).toBe(`/p/7/apps/${sigilId}/`);
    expect(router.path("appAnalytics", { params })).toBe(
      `/p/7/apps/${sigilId}/analytics`,
    );
    expect(router.path("appPerformance", { params })).toBe(
      `/p/7/apps/${sigilId}/performance`,
    );
    expect(router.path("appErrors", { params })).toBe(
      `/p/7/apps/${sigilId}/errors`,
    );
    expect(router.path("appSettings", { params })).toBe(
      `/p/7/apps/${sigilId}/settings`,
    );
  });

  it("still resolves every other name the sidebar and settings nav use", ({
    expect,
  }) => {
    const params = { projectId: "7" };
    for (const name of [
      "projectQuests",
      "projectBlights",
      "projectFeedback",
      "projectMilestones",
      "projectFolios",
      "projectReports",
      "projectSettingsBanner",
      "projectSettingsSigils",
    ]) {
      expect(() => router.path(name, { params })).not.toThrow();
    }
  });

  it("has no project-level Insights route left", ({ expect }) => {
    // Deleted in favour of the per-app tabs. If it comes back, it needs a nav
    // entry too — an orphan route is how the last one rotted.
    expect(() => router.path("projectInsights", { params: {} })).toThrow();
  });
});
