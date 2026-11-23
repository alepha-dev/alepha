import { BuildShell } from "@lore/build/web";
import { CAPABILITY_KEYS, type CapabilityKey } from "@lore/core/schemas";
import { projectFixture } from "@lore/core/testing";
import {
  ProjectShellRegistry,
  currentProjectAtom,
  CORE_NAV,
  NAV_BANDS,
  type ProjectShellContext,
} from "@lore/core/web";
import { WorkShell } from "@lore/plan/web";
import { KnowledgeShell } from "@lore/remember/web";
import {
  currentErrorCountAtom,
  currentInstancesAtom,
  DeployShell,
} from "@lore/ship/web";
import { Alepha, type Atom } from "alepha";
import { describe, it } from "vitest";

/**
 * What the sidebar offers, without rendering one.
 *
 * `ProjectView` used to answer this with a chain of nine `if (features.x)`,
 * and the only way to assert it was to mount the whole shell. The entries are
 * data each module registers (#E75, #Q2624), so the question is a pure
 * function of the capability set - which makes the cases below the ones
 * nobody could write before: a Remember-only project, and a project with
 * everything off.
 *
 * ⚠️ The last case is the one to keep. A project with no capability at all is
 * a legal state, deliberately, and the sidebar it gets is the proof that
 * turning everything off leaves an app rather than a broken page.
 */
const alepha = Alepha.create();
alepha.inject(WorkShell);
alepha.inject(KnowledgeShell);
alepha.inject(DeployShell);
alepha.inject(BuildShell);
const shell = alepha.inject(ProjectShellRegistry);

/**
 * Every permission an entry opens on: the rank filter is the registry's
 * last, and these cases are about capabilities.
 */
const PERMISSIONS = [
  ...new Set(
    [
      ...CORE_NAV,
      ...CAPABILITY_KEYS.flatMap((key) => shell.navOf(key)),
    ].flatMap((entry) => (entry.permission ? [entry.permission] : [])),
  ),
];

const contextWith = (state: Array<[Atom<any>, unknown]> = []) => {
  const values = new Map(state.map(([atom, value]) => [atom.key, value]));
  return {
    routeName: "projectQuests",
    params: {},
    get: (atom) => values.get(atom.key) as never,
  } satisfies ProjectShellContext;
};

const offered = (
  project: ReturnType<typeof projectFixture>,
  context: ProjectShellContext = contextWith(),
): string[] =>
  shell
    .offeredNav({ ...project, permissions: PERMISSIONS } as never, {
      ...context,
      get: (atom) =>
        atom.key === currentProjectAtom.key
          ? (project as never)
          : context.get(atom),
    })
    .map((entry) => entry.route);

describe("the sidebar, derived from capabilities", () => {
  it("offers everything to a project that has everything", ({ expect }) => {
    const routes = offered(projectFixture());

    expect(routes).toContain("projectQuests");
    // The board is a tab of Quests, not a sidebar entry.
    expect(routes).not.toContain("projectKanban");
    expect(routes).toContain("projectEpics");
    expect(routes).toContain("projectReleases");
    expect(routes).toContain("projectFolios");
    expect(routes).toContain("projectApps");
    expect(routes).toContain("projectFeedback");
  });

  it("gives a Remember-only project one entry beside the core three", ({
    expect,
  }) => {
    const routes = offered(
      projectFixture({ capabilities: ["remember", "activity", "reports"] }),
    );

    // The shape that was impossible before this epic: quests had no flag at
    // all, so every project had them whether or not it wanted them.
    expect(routes.sort((a, b) => a.localeCompare(b))).toEqual([
      "projectActivity",
      "projectDashboard",
      "projectFolios",
      "projectReports",
    ]);
  });

  it("leaves the dashboard standing with every capability off", ({
    expect,
  }) => {
    const routes = offered(projectFixture({ capabilities: [] }));

    // ⚠️ The dashboard is FIRST and Core: it is the page a bare project URL
    // lands on (#Q2104), so a capability set that could hide it would lock
    // somebody out of their own project. On a project with nothing turned on
    // it renders its empty state, which is a true thing to read. Activity
    // and Reports have their own switch since #Q4007.
    expect(routes).toEqual(["projectDashboard"]);
  });

  it("hides Activity and Reports each with its own switch (#Q4007)", ({
    expect,
  }) => {
    const all = offered(projectFixture());
    expect(all).toContain("projectActivity");
    expect(all).toContain("projectReports");

    const keys = CAPABILITY_KEYS.filter(
      (key) => key !== "activity" && key !== "reports",
    );
    const withoutActivity = offered(
      projectFixture({ capabilities: [...keys, "reports"] }),
    );
    expect(withoutActivity).not.toContain("projectActivity");
    expect(withoutActivity).toContain("projectReports");

    const withoutReports = offered(
      projectFixture({ capabilities: [...keys, "activity"] }),
    );
    expect(withoutReports).toContain("projectActivity");
    expect(withoutReports).not.toContain("projectReports");
  });

  it("lights the Dashboard entry on every dashboard of the project", ({
    expect,
  }) => {
    // A named dashboard is the same page (#Q3300): the entry stays lit
    // there, and nowhere else.
    const entry = CORE_NAV.find((it) => it.route === "projectDashboard")!;
    expect(entry.activeOn?.("projectDashboard")).toBe(true);
    expect(entry.activeOn?.("projectDashboardNamed")).toBe(true);
    expect(entry.activeOn?.("projectActivity")).toBe(false);
  });

  it("gives Build its own band: Code with repositories, Quality with quality and Reports (#Q4133)", ({
    expect,
  }) => {
    const all = offered(projectFixture());
    expect(all).toContain("projectCode");
    expect(all).toContain("reportsQuality");
    const build = shell.navOf("build");
    expect(build.map((entry) => entry.group)).toEqual(["build", "build"]);

    expect(
      offered(
        projectFixture({
          options: { build: { repositories: false, quality: true } },
        }),
      ),
    ).not.toContain("projectCode");
    expect(
      offered(
        projectFixture({
          options: { build: { repositories: true, quality: false } },
        }),
      ),
    ).not.toContain("reportsQuality");
    // Quality is a Reports tab: without Reports it has no page to open.
    const noReports = offered(
      projectFixture({ capabilities: ["build", "activity"] }),
    );
    expect(noReports).toContain("projectCode");
    expect(noReports).not.toContain("reportsQuality");
  });

  it("lights Quality alone on its tab, never Reports beside it (#Q4133)", ({
    expect,
  }) => {
    const reports = CORE_NAV.find((entry) => entry.route === "projectReports")!;
    expect(reports.activeOn?.("reportsQuality")).toBe(false);
    expect(reports.activeOn?.("reportsFlow")).toBe(true);
    expect(NAV_BANDS.indexOf("build")).toBe(NAV_BANDS.indexOf("record") + 1);
    expect(NAV_BANDS.indexOf("ops")).toBe(NAV_BANDS.indexOf("build") + 1);
  });

  it("offers no Notifications entry, at any capability set", ({ expect }) => {
    // ⚠️ Absent from the RAIL, not from the app (feedback #P2127): the header
    // bell is the only door, and two badged controls for one page, one of
    // them three centimetres from the other, is what the report was about.
    //
    // The page itself is still Core - the events that fill it came from
    // `work` (quest mentions, releases) and `support` (feedback mentions)
    // before #E143 folded both into `plan`, so it could never have hung off
    // either - which is why this holds whatever is
    // enabled rather than only for a bare project.
    for (const capabilities of [[], ["plan"], ["remember"], ["ship"]]) {
      expect(
        offered(projectFixture({ capabilities: capabilities as never })),
      ).not.toContain("projectInbox");
    }
  });

  it("drops an entry whose option is off, and keeps its siblings", ({
    expect,
  }) => {
    const routes = offered(
      projectFixture({
        capabilities: ["plan"],
        options: { plan: { releases: false } },
      }),
    );

    expect(routes).toContain("projectQuests");
    expect(routes).toContain("projectEpics");
    expect(routes).not.toContain("projectReleases");
  });

  it("hides Errors until something collects or filed one", ({ expect }) => {
    const apps = projectFixture({ capabilities: ["ship"] });

    // Tracking on and nothing to show: the entry would be a door onto an
    // empty room for every project that never enrolled an app.
    expect(offered(apps)).not.toContain("projectErrors");

    // An error OUTLIVES the app that reported it - `projectErrors.sigilId` is
    // `ON DELETE SET NULL` and rows survive for the retention window - so an
    // owner who deleted their only app must not lose the inbox with it.
    expect(
      offered(apps, contextWith([[currentErrorCountAtom, { count: 3 }]])),
    ).toContain("projectErrors");
    expect(
      offered(
        apps,
        contextWith([
          [currentInstancesAtom, [{ sigil: { kinds: ["errors"] } }]],
        ]),
      ),
    ).toContain("projectErrors");
  });

  it("keeps the Ship baseline when tracking is off", ({ expect }) => {
    // The "I deploy on Vercel and only want error tracking" reader, in
    // reverse: Apps on, telemetry off. Instances and artifacts do not hang
    // off tracking, so both doors stay - `track` adds the sigil surfaces to them
    // rather than being what makes them exist.
    const routes = offered(
      projectFixture({
        capabilities: ["ship"],
        options: { ship: { track: false } },
      }),
    );

    expect(routes).toContain("projectApps");
    expect(routes).toContain("projectArtifacts");
    // Errors is telemetry, so it goes with `track`.
    expect(routes).not.toContain("projectErrors");
  });

  it("hides Artifacts when the deploy option is off (#Q3631)", ({ expect }) => {
    // Builds pushed to be deployed: without Deploy the page means nothing.
    const off = offered(
      projectFixture({
        capabilities: ["ship"],
        options: { ship: { deploy: false } },
      }),
    );
    expect(off).toContain("projectApps");
    expect(off).not.toContain("projectArtifacts");

    const on = offered(
      projectFixture({
        capabilities: ["ship"],
        options: { ship: { deploy: true } },
      }),
    );
    expect(on).toContain("projectArtifacts");
  });

  it("declares every entry under exactly one capability", ({ expect }) => {
    // Two capabilities claiming one route means whichever is declared first
    // decides, and the other's gate never runs.
    //
    // ⚠️ Keyed on the CAPABILITY per route, not on the route alone, so that a
    // route shared inside ONE capability stays legal: there is no second gate
    // to be skipped. That every destination is still offered once is the
    // separate check below.
    const owners = new Map<string, string>();
    for (const key of CAPABILITY_KEYS as readonly CapabilityKey[]) {
      for (const entry of shell.navOf(key)) {
        const existing = owners.get(entry.route);
        expect(
          existing === undefined || existing === key,
          `${entry.route} is claimed by both ${existing} and ${key}`,
        ).toBe(true);
        owners.set(entry.route, key);
      }
    }

    for (const entry of CORE_NAV) {
      expect(
        owners.has(entry.route),
        `${entry.route} is in CORE_NAV and under a capability`,
      ).toBe(false);
    }
  });

  it("offers each destination once", ({ expect }) => {
    // Two entries pointing at the same place is a duplicate row in the
    // sidebar.
    const all = [
      ...CORE_NAV,
      ...CAPABILITY_KEYS.flatMap((key) => shell.navOf(key)),
    ].map((entry) => entry.route);

    expect(new Set(all).size).toBe(all.length);
  });
});
