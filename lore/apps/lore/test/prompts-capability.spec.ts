import { ProjectCapabilityController } from "@lore/core/api";
import { createTestEpic } from "@lore/plan/testing";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Prompts is a capability, `prompts`, off by default (#E175, #Q4313).
 * Turning it off keeps every row: the prompts, their triggers and pins, and
 * the jobs; turning it back on finds them as they were.
 */
describe("the prompts capability", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
  });
  afterEach(async () => {
    await w.stop();
  });

  const setPrompts = (enabled: boolean) =>
    w.alepha.inject(ProjectCapabilityController).setCapability.run(
      {
        params: { projectId: w.projectId, key: "prompts" },
        body: { enabled },
      },
      { user: w.owner },
    );
  const promptRows = () =>
    w.repos.prompts.findMany({
      where: { projectId: { eq: w.projectId } },
      orderBy: [{ column: "name", direction: "asc" }],
    });

  it("keeps the prompts, their triggers and pins, and the jobs, off then on", async ({
    expect,
  }) => {
    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const epic = await createTestEpic(w.alepha, project, { status: "ready" });
    await w.controller.createPrompt.run(
      {
        params: { projectId: w.projectId },
        body: { name: "standup", text: "Summarise yesterday." } as never,
      },
      { user: w.owner },
    );
    await w.controller.updatePrompt.run(
      {
        params: { projectId: w.projectId, name: "work-epic" },
        body: {
          on: "daily@7",
          argValues: { epic: String(epic.number) },
        } as never,
      },
      { user: w.owner },
    );
    const before = await promptRows();
    const jobsBefore = await w.repos.jobs.findMany({});
    expect(before.map((it) => it.name)).toEqual(["standup", "work-epic"]);

    await setPrompts(true);
    await setPrompts(false);
    expect(await promptRows()).toEqual(before);
    expect(await w.repos.jobs.findMany({})).toEqual(jobsBefore);

    await setPrompts(true);
    expect(await promptRows()).toEqual(before);
    expect(await w.repos.jobs.findMany({})).toEqual(jobsBefore);
  });
});
