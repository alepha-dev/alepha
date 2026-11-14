import { projectFixture } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  pageCrumbAtom,
  ProjectShellRegistry,
  ProjectTrail,
} from "@lore/core/web";
import { currentHostAtom, DeployShell } from "@lore/deploy/web";
import { currentAreaAtom, WorkShell } from "@lore/work/web";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { ReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

/**
 * A detail page ends its breadcrumb trail with itself (#Q3408), where three
 * of them used to carry a back link in their body instead: a host's
 * console ("All hosts"), an area's settings page ("Back to areas") and
 * the automation gallery ("Back to automations"). The trail above them
 * (Project > section) comes from `ProjectView`; these are the leaves the
 * modules contribute, read the way `ProjectView` reads them.
 */
/**
 * Paths without a route table: the trail's labels are what these specs read.
 */
class PathRouter extends ReactRouter<any> {
  public override path(name: string): any {
    return `/${name}`;
  }
}

describe("the leaf crumb of a detail page", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReactI18n)
      .with({ provide: ReactRouter, use: PathRouter });
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    alepha.inject(DeployShell);
    alepha.inject(ProjectTrail);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ id: 7, title: "MCS", slug: "mcs" }),
    );

    const leaves = (routeName: string, params: Record<string, string> = {}) =>
      alepha
        .inject(ProjectShellRegistry)
        .crumbContributions()
        .map((contribution) =>
          contribution.crumb({
            routeName,
            params,
            get: (atom) => alepha.store.get(atom as any) as any,
            projectSlug: "mcs",
            path: (route, routeParams) =>
              `${route}:${JSON.stringify(routeParams)}`,
          }),
        )
        .filter((crumb) => crumb !== undefined);

    return { alepha, leaves };
  };

  it("a host's console ends with the host, on every tab", async ({
    expect,
  }) => {
    const { alepha, leaves } = await setup();
    alepha.store.set(currentHostAtom, {
      id: "00000000-0000-4000-8000-0000000000a1",
      slug: "ovh",
      type: "bay",
      online: false,
      overdue: false,
      deployAllowed: false,
      collectSeries: false,
      statsIntervalSeconds: 1800,
      acceptedRuntimes: ["node"],
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      project: { id: 7, title: "MCS", slug: "mcs" },
      can: ["host:read"],
      projects: [],
    } as any);

    for (const route of ["bayOverview", "bayApps", "baySettings"]) {
      const crumbs = leaves(route, { hostSlug: "ovh" });
      expect(crumbs).toHaveLength(1);
      expect(crumbs[0]?.label).toBe("ovh");
      expect(crumbs[0]?.href).toContain("bayOverview");
    }
  });

  it("an area's settings page ends with the area's name", async ({
    expect,
  }) => {
    const { alepha, leaves } = await setup();
    alepha.store.set(currentAreaAtom, {
      id: 3,
      projectId: 7,
      name: "alepha/api/users",
      description: "",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      questCount: 0,
      openQuestCount: 0,
    });

    expect(leaves("projectSettingsArea", { areaId: "3" })).toEqual([
      { label: "alepha/api/users" },
    ]);
    // Nothing leaks onto the list it belongs to.
    expect(leaves("projectSettingsAreas")).toEqual([]);
  });

  it("the title is the trail the breadcrumb draws, joined", async ({
    expect,
  }) => {
    const { alepha } = await setup();
    alepha.store.set(currentAreaAtom, {
      id: 3,
      projectId: 7,
      name: "alepha/api/users",
      description: "",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      questCount: 0,
      openQuestCount: 0,
    });
    const trail = alepha.inject(ProjectTrail);

    const crumbs = trail.crumbs("projectSettingsArea", { areaId: "3" });

    expect(crumbs[0]).toEqual({ label: "MCS", href: "/project" });
    expect(crumbs.at(-1)).toEqual({ label: "alepha/api/users" });
    expect(trail.title("projectSettingsArea", { areaId: "3" })).toBe(
      crumbs.map((crumb) => crumb.label).join(" › "),
    );
  });

  it("a leaf a page names for itself lands on that page only", async ({
    expect,
  }) => {
    const { alepha } = await setup();
    const trail = alepha.inject(ProjectTrail);
    alepha.store.set(pageCrumbAtom, {
      routeName: "projectAutomationDetail",
      label: "Notify on deploy",
    });

    expect(trail.title("projectAutomationDetail", {})).toMatch(
      / › Notify on deploy$/,
    );
    expect(trail.title("projectAutomations", {})).not.toContain(
      "Notify on deploy",
    );
  });
});
