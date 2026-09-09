import { describe, it } from "vitest";

import {
  CAPABILITY_KEYS,
  type CapabilityKey,
} from "@/api/schemas/capabilityKeySchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import {
  capabilityOption,
  hasCapability,
} from "@/web/app/services/projectCapabilities.ts";

import {
  CAPABILITY_NAV,
  type CapabilityNavContext,
  type CapabilityNavEntry,
  CORE_NAV,
} from "./capabilityNav.ts";

/**
 * What the sidebar offers, without rendering one.
 *
 * `ProjectView` used to answer this with a chain of nine `if (features.x)`,
 * and the only way to assert it was to mount the whole shell. The chain is a
 * map now, so the question is a pure function of the capability set - which
 * makes the cases below the ones nobody could write before: a Knowledge-only
 * project, and a project with everything off.
 *
 * ⚠️ The last case is the one to keep. A project with no capability at all is
 * a legal state, deliberately, and the sidebar it gets is the proof that
 * turning everything off leaves an app rather than a broken page.
 */
const CONTEXT: CapabilityNavContext = {
  routeName: "projectQuests",
  collectsBlights: false,
};

const offered = (
  project: {
    capabilities: Array<{ key: string; options: Record<string, boolean> }>;
  },
  context: CapabilityNavContext = CONTEXT,
): string[] =>
  [
    ...CORE_NAV,
    ...CAPABILITY_KEYS.flatMap((key) =>
      hasCapability(project as never, key)
        ? CAPABILITY_NAV[key].filter(
            (entry: CapabilityNavEntry) =>
              (!entry.option ||
                capabilityOption(project as never, key, entry.option)) &&
              (!entry.available || entry.available(context)),
          )
        : [],
    ),
  ].map((entry) => entry.route);

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
    expect(offered(apps, { ...CONTEXT, blightCount: 3 })).toContain(
      "projectBlights",
    );
    expect(offered(apps, { ...CONTEXT, collectsBlights: true })).toContain(
      "projectBlights",
    );
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
    for (const key of Object.keys(CAPABILITY_NAV) as CapabilityKey[]) {
      for (const entry of CAPABILITY_NAV[key]) {
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
      ...(Object.keys(CAPABILITY_NAV) as CapabilityKey[]).flatMap(
        (key) => CAPABILITY_NAV[key],
      ),
    ].map((entry) => entry.route);

    expect(new Set(all).size).toBe(all.length);
  });
});
