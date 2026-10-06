import { CAPABILITY_KEYS, type CapabilityKey } from "@lore/core/schemas";
import { projectFixture } from "@lore/core/testing";
import {
  ProjectShellRegistry,
  CORE_NAV,
  type ProjectShellContext,
} from "@lore/core/web";
import {
  currentBlightCountAtom,
  currentInstancesAtom,
  DeployShell,
} from "@lore/deploy/web";
import { KnowledgeShell } from "@lore/knowledge/web";
import { WorkShell } from "@lore/work/web";
import { Alepha, type Atom } from "alepha";
import { describe, it } from "vitest";

/**
 * What the sidebar offers, without rendering one.
 *
 * `ProjectView` used to answer this with a chain of nine `if (features.x)`,
 * and the only way to assert it was to mount the whole shell. The entries are
 * data each module registers (#E75, #Q2624), so the question is a pure
 * function of the capability set - which makes the cases below the ones
 * nobody could write before: a Knowledge-only project, and a project with
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
    .offeredNav({ ...project, permissions: PERMISSIONS } as never, context)
    .map((entry) => entry.route);

describe("the sidebar, derived from capabilities", () => {
  it("offers everything to a project that has everything", ({ expect }) => {
    const routes = offered(projectFixture());

    expect(routes).toContain("projectQuests");
    expect(routes).toContain("projectKanban");
    expect(routes).toContain("projectEpics");
    expect(routes).toContain("projectReleases");
    expect(routes).toContain("projectFolios");
    expect(routes).toContain("projectApps");
    expect(routes).toContain("projectFeedback");
  });

  it("gives a Knowledge-only project one entry beside the core three", ({
    expect,
  }) => {
    const routes = offered(projectFixture({ capabilities: ["knowledge"] }));

    // The shape that was impossible before this epic: quests had no flag at
    // all, so every project had them whether or not it wanted them.
    expect(routes.sort((a, b) => a.localeCompare(b))).toEqual([
      "projectActivity",
      "projectDashboard",
      "projectFolios",
      "projectReports",
    ]);
  });

  it("leaves the three core entries standing with every capability off", ({
    expect,
  }) => {
    const routes = offered(projectFixture({ capabilities: [] }));

    // ⚠️ The dashboard is FIRST and Core: it is the page a bare project URL
    // lands on (#Q2104), so a capability set that could hide it would lock
    // somebody out of their own project. On a project with nothing turned on
    // it renders its empty state, which is a true thing to read.
    //
    // Activity says something whatever else is turned off, and Reports is
    // Core because its TABS declare capabilities - an Apps-only project
    // reaches Quality through it.
    expect(routes).toEqual([
      "projectDashboard",
      "projectActivity",
      "projectReports",
    ]);
  });

  it("offers no Notifications entry, at any capability set", ({ expect }) => {
    // ⚠️ Absent from the RAIL, not from the app (feedback #P2127): the header
    // bell is the only door, and two badged controls for one page, one of
    // them three centimetres from the other, is what the report was about.
    //
    // The page itself is still Core - the events that fill it span `work`
    // (quest mentions, releases) and `support` (feedback mentions), so it
    // could never have hung off either - which is why this holds whatever is
    // enabled rather than only for a bare project.
    for (const capabilities of [[], ["work"], ["knowledge"], ["support"]]) {
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
        capabilities: ["work"],
        options: { work: { board: false, releases: false } },
      }),
    );

    expect(routes).toContain("projectQuests");
    expect(routes).toContain("projectEpics");
    expect(routes).not.toContain("projectKanban");
    expect(routes).not.toContain("projectReleases");
  });

  it("hides Blights until something collects or filed one", ({ expect }) => {
    const apps = projectFixture({ capabilities: ["apps"] });

    // Tracking on and nothing to show: the entry would be a door onto an
    // empty room for every project that never enrolled an app.
    expect(offered(apps)).not.toContain("projectBlights");

    // A blight OUTLIVES the app that reported it - `blights.sigilId` is
    // `ON DELETE SET NULL` and rows survive for the retention window - so an
    // owner who deleted their only app must not lose the inbox with it.
    expect(
      offered(apps, contextWith([[currentBlightCountAtom, { count: 3 }]])),
    ).toContain("projectBlights");
    expect(
      offered(
        apps,
        contextWith([
          [currentInstancesAtom, [{ sigil: { kinds: ["blights"] } }]],
        ]),
      ),
    ).toContain("projectBlights");
  });

  it("keeps the Apps baseline when tracking is off", ({ expect }) => {
    // The "I deploy on Vercel and only want error tracking" reader, in
    // reverse: Apps on, telemetry off. Instances and artifacts are the
    // baseline, so both doors stay - `track` adds the sigil surfaces to them
    // rather than being what makes them exist.
    const routes = offered(
      projectFixture({
        capabilities: ["apps"],
        options: { apps: { track: false } },
      }),
    );

    expect(routes).toContain("projectApps");
    expect(routes).toContain("projectArtifacts");
    // Blights is telemetry, so it goes with `track`.
    expect(routes).not.toContain("projectBlights");
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
