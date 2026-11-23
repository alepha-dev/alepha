import { projectFixture } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  pageCrumbAtom,
  ProjectShellRegistry,
  ProjectTrail,
  SECTION_HREF_ROUTES,
  currentHostAtom,
  HostShell,
} from "@lore/core/web";
import {
  currentPersonaAtom,
  RequirementsShell,
} from "@lore/plan-requirements/web";
import { currentAreaAtom, WorkShell } from "@lore/plan/web";
import { DeployShell } from "@lore/ship/web";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import * as reactRouter from "alepha/react/router";
import { ReactRouter } from "alepha/react/router";
import { afterEach, describe, it } from "vitest";

/**
 * A detail page ends its breadcrumb trail with itself (#Q3408), where three
 * of them used to carry a back link in their body instead: a host's
 * console ("All hosts"), an area's settings page ("Back to areas") and
 * a page's own back link. The trail above them
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

/**
 * Starting the container in jsdom mounts the app into the document, and
 * stopping it does not unmount that root: React work it scheduled would fire
 * after jsdom is torn down ("window is not defined") and fail the run with
 * every test green. This substitute unmounts on demand.
 *
 * ⚠️ Untyped on purpose: the renderer is exported by the browser entry of
 * `alepha/react/router`, which is the one jsdom loads, while the types are
 * the server entry's, which does not export it.
 */
const Renderer = (reactRouter as any).ReactBrowserRendererProvider;

class UnmountingRenderer extends Renderer {
  public unmount(): void {
    (this as any).root?.unmount();
    (this as any).root = undefined;
  }
}

describe("the leaf crumb of a detail page", () => {
  const containers: Alepha[] = [];

  afterEach(async () => {
    for (const alepha of containers.splice(0)) {
      (alepha.inject(UnmountingRenderer) as UnmountingRenderer).unmount();
      await alepha.stop();
    }
  });

  const setup = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReactI18n)
      .with({ provide: ReactRouter, use: PathRouter })
      .with({ provide: Renderer, use: UnmountingRenderer });
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    alepha.inject(RequirementsShell);
    alepha.inject(DeployShell);
    alepha.inject(HostShell);
    alepha.inject(ProjectTrail);
    await alepha.start();
    containers.push(alepha);
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
        .filter((crumb) => crumb !== undefined)
        // A leaf named by an i18n key reads as its key here.
        .map((crumb) =>
          "labelKey" in crumb
            ? { label: crumb.labelKey, href: crumb.href }
            : crumb,
        );

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
      jobsAllowed: false,
      agentHost: false,
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

  it("a persona's page ends with its reference alone, as an epic's (#E153)", async ({
    expect,
  }) => {
    const { alepha, leaves } = await setup();
    alepha.store.set(currentPersonaAtom, {
      id: 4,
      projectId: 7,
      number: 2,
      kind: "human",
      name: "Léa",
      who: "",
      goals: "",
      frustrations: "",
      areas: [],
      createdAt: "2026-11-10T10:00:00.000Z",
      updatedAt: "2026-11-10T10:00:00.000Z",
    });

    const crumbs = leaves("projectPersona", { personaNumber: "2" });
    // No crumb for the tab, and no title: "Acme > Requirements > #A2".
    expect(crumbs.map((it) => it?.label)).toEqual(["#A2"]);
    expect(crumbs[0]?.href).toBeUndefined();
    expect(leaves("projectPersonas")).toEqual([]);
    // "Requirements" climbs back to the tab that lists the page.
    expect(SECTION_HREF_ROUTES.projectPersona).toBe("projectPersonas");
    expect(SECTION_HREF_ROUTES.projectUseCase).toBe("projectUseCases");
  });

  it("the test book names itself (#E153)", async ({ expect }) => {
    const { leaves } = await setup();
    expect(
      leaves("projectRequirementsTestBook").map((it) => it?.label),
    ).toEqual(["requirements.trace.export.testBook"]);
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

  it("an artifact page ends with app/tag, Artifacts linking back", async ({
    expect,
  }) => {
    const { alepha, leaves } = await setup();
    const params = { app: "shop", artifactTag: "latest" };

    expect(leaves("projectArtifact", params)).toEqual([
      { label: "shop/latest" },
    ]);
    // Nothing leaks onto the list it belongs to.
    expect(leaves("projectArtifacts")).toEqual([]);

    const trail = alepha.inject(ProjectTrail);
    expect(trail.crumbs("projectArtifact", params)).toEqual([
      { label: "MCS", href: "/project" },
      { label: "Artifacts", href: "/projectArtifacts" },
      { label: "shop/latest" },
    ]);
    expect(trail.title("projectArtifact", params)).toBe(
      "MCS › Artifacts › shop/latest",
    );
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
      routeName: "projectSettingsNotificationChannels",
      label: "Webhook to CI",
    });

    expect(trail.title("projectSettingsNotificationChannels", {})).toMatch(
      / › Webhook to CI$/,
    );
    expect(trail.title("projectSettingsNotifications", {})).not.toContain(
      "Webhook to CI",
    );
  });
});
