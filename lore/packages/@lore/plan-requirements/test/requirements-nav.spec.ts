import { projectFixture } from "@lore/core/testing";
import {
  CORE_NAV,
  NAV_BANDS,
  ProjectShellRegistry,
  type ProjectShellContext,
} from "@lore/core/web";
import { WorkShell } from "@lore/plan/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { RequirementsShell } from "../src/web/app/shell/RequirementsShell.ts";

/**
 * Requirements' sidebar entries (#E153, #Q3763, #Q3871): Personas, Use
 * cases and Requirements, one per list page, in a band of their own hanging
 * off Plan's `requirements` option, and nothing else in the sidebar moved.
 */
const ROUTES = ["projectPersonas", "projectUseCases", "projectRequirements"];
const boot = () => {
  const alepha = Alepha.create();
  alepha.inject(WorkShell);
  alepha.inject(RequirementsShell);
  return alepha.inject(ProjectShellRegistry);
};

const context: ProjectShellContext = {
  routeName: "projectRequirements",
  params: {},
  get: () => undefined,
};

const offered = (
  shell: ProjectShellRegistry,
  options: Record<string, boolean>,
): string[] => {
  const permissions = [...CORE_NAV, ...shell.navOf("plan")].flatMap((entry) =>
    entry.permission ? [entry.permission] : [],
  );
  return shell
    .offeredNav(
      {
        ...projectFixture({
          capabilities: ["plan"],
          options: { plan: { epics: true, feedback: true, ...options } },
        }),
        permissions,
      } as never,
      context,
    )
    .map((entry) => entry.route);
};

describe("the Requirements sidebar entries", () => {
  it("is offered with Plan's requirements option on, and only then", ({
    expect,
  }) => {
    const shell = boot();

    expect(offered(shell, { requirements: true })).toEqual(
      expect.arrayContaining(ROUTES),
    );
    for (const route of ROUTES) {
      expect(offered(shell, { requirements: false })).not.toContain(route);
    }
  });

  it("fill their own band, between Work (Errors) and Record (Folios), Personas first", ({
    expect,
  }) => {
    const plan = boot().navOf("plan");
    const band = plan
      .filter((it) => it.group === "requirements")
      .sort((a, b) => a.order - b.order);

    expect(band.map((it) => it.route)).toEqual(ROUTES);
    expect(NAV_BANDS.indexOf("requirements")).toBe(
      NAV_BANDS.indexOf("work") + 1,
    );
    expect(NAV_BANDS.indexOf("record")).toBe(
      NAV_BANDS.indexOf("requirements") + 1,
    );
    expect(band.map((it) => it.permission)).toEqual([
      "persona:read",
      "usecase:read",
      "requirement:read",
    ]);
    for (const entry of band) {
      expect(entry.option).toBe("requirements");
      // No count (#Q4241): a total said nothing there, and it was wrong.
      expect(entry.badge).toBeUndefined();
      expect(entry.reads).toBeUndefined();
    }
  });

  it("light each on its list and on the pages a row of it opens", ({
    expect,
  }) => {
    const plan = boot().navOf("plan");
    const lit = (route: string) =>
      plan
        .filter((it) => ROUTES.includes(it.route))
        .filter((it) => it.activeOn?.(route))
        .map((it) => it.route);

    expect(lit("projectPersonas")).toEqual(["projectPersonas"]);
    expect(lit("projectPersona")).toEqual(["projectPersonas"]);
    expect(lit("projectUseCases")).toEqual(["projectUseCases"]);
    expect(lit("projectUseCase")).toEqual(["projectUseCases"]);
    expect(lit("projectRequirements")).toEqual(["projectRequirements"]);
    expect(lit("projectRequirementsTestBook")).toEqual(["projectRequirements"]);
    expect(lit("projectEpics")).toEqual([]);
  });

  it("moves nothing else: the bands and Plan's own entries are untouched", ({
    expect,
  }) => {
    const alone = Alepha.create();
    alone.inject(WorkShell);
    const before = alone
      .inject(ProjectShellRegistry)
      .navOf("plan")
      .map((it) => [it.route, it.group, it.order]);
    const after = boot()
      .navOf("plan")
      .filter((it) => !ROUTES.includes(it.route))
      .map((it) => [it.route, it.group, it.order]);

    expect(after).toEqual(before);
    expect(NAV_BANDS).toEqual([
      "activity",
      "work",
      "requirements",
      "record",
      "ops",
      "config",
    ]);
  });

  it("extends Plan's entries: registerNav still refuses a second registration", ({
    expect,
  }) => {
    const shell = boot();

    expect(() => shell.registerNav("plan", [])).toThrow(/registered twice/);
    expect(() =>
      shell.extendNav("plan", [{ ...shell.navOf("plan").at(-1)!, order: 99 }]),
    ).toThrow(/registered twice/);
  });
});
