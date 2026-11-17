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
 * Requirements' one sidebar entry (#E153, #Q3763): under Plan, right after
 * Epics, hanging off Plan's `requirements` option, and nothing else in the
 * sidebar moved (owner, answers 53 and 64).
 */
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

describe("the Requirements sidebar entry", () => {
  it("is offered with Plan's requirements option on, and only then", ({
    expect,
  }) => {
    const shell = boot();

    expect(offered(shell, { requirements: true })).toContain(
      "projectRequirements",
    );
    expect(offered(shell, { requirements: false })).not.toContain(
      "projectRequirements",
    );
  });

  it("sits alone in its own band, between Work (Errors) and Record (Folios)", ({
    expect,
  }) => {
    const plan = boot().navOf("plan");
    const entry = plan.find((it) => it.route === "projectRequirements");

    expect(entry?.group).toBe("requirements");
    expect(
      plan.filter((it) => it.group === "requirements").map((it) => it.route),
    ).toEqual(["projectRequirements"]);
    expect(NAV_BANDS.indexOf("requirements")).toBe(
      NAV_BANDS.indexOf("work") + 1,
    );
    expect(NAV_BANDS.indexOf("record")).toBe(
      NAV_BANDS.indexOf("requirements") + 1,
    );
    expect(entry?.option).toBe("requirements");
    expect(entry?.permission).toBe("requirement:read");
    expect(entry?.badge).toBeUndefined();
  });

  it("stays lit on every tab and on a persona or use case page", ({
    expect,
  }) => {
    const entry = boot()
      .navOf("plan")
      .find((it) => it.route === "projectRequirements");

    for (const route of [
      "projectRequirements",
      "projectUseCases",
      "projectPersonas",
      "projectPersona",
      "projectUseCase",
    ]) {
      expect(entry?.activeOn?.(route)).toBe(true);
    }
    expect(entry?.activeOn?.("projectEpics")).toBe(false);
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
      .filter((it) => it.route !== "projectRequirements")
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
