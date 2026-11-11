import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n, ProjectShellRegistry } from "@lore/core/web";
import { currentEstateAtom, DeployShell } from "@lore/deploy/web";
import { currentAreaAtom, WorkShell } from "@lore/work/web";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { describe, it } from "vitest";

/**
 * A detail page ends its breadcrumb trail with itself (#Q3408), where three
 * of them used to carry a back link in their body instead: an estate's
 * console ("All estates"), an area's settings page ("Back to areas") and
 * the automation gallery ("Back to automations"). The trail above them
 * (Project > section) comes from `ProjectView`; these are the leaves the
 * modules contribute, read the way `ProjectView` reads them.
 */
describe("the leaf crumb of a detail page", () => {
  const setup = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    alepha.inject(DeployShell);
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

  it("an estate's console ends with the estate, on every tab", async ({
    expect,
  }) => {
    const { alepha, leaves } = await setup();
    alepha.store.set(currentEstateAtom, {
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
      can: ["estate:read"],
      projects: [],
    } as any);

    for (const route of ["bayOverview", "bayApps", "baySettings"]) {
      const crumbs = leaves(route, { estateSlug: "ovh" });
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
});
