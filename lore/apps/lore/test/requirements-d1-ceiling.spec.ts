import {
  PersonaController,
  PersonaInsightController,
  RequirementController,
  RequirementCoverageController,
  RunController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { EpicController } from "@lore/plan/api";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Requirements past D1's 100 bound parameters (#Q3959). A project with 276
 * use cases read an empty Use cases page on lore.alepha.app: the list
 * hydrated every use case through one `inArray` over all their ids, which D1
 * refuses past 100 values. Every read here runs on a SQLite that refuses the
 * same, over more use cases than one statement may name.
 */
describe("requirements past D1's bind limit", () => {
  const COUNT = 120;
  let ctx: RequirementsProject;
  let useCases: UseCaseController;
  let requirements: RequirementController;
  let personas: PersonaController;
  let personaNumber: number;
  let requirementNumber: number;

  beforeAll(async () => {
    ctx = await requirementsProject({ d1: true });
    const as = ctx.as(ctx.owner);
    const params = { projectId: ctx.projectId };
    useCases = ctx.alepha.inject(UseCaseController);
    requirements = ctx.alepha.inject(RequirementController);
    personas = ctx.alepha.inject(PersonaController);
    const runs = ctx.alepha.inject(RunController);
    const epics = ctx.alepha.inject(EpicController);

    const lea = (
      await personas.createPersona.fetch({ params, body: { name: "Léa" } }, as)
    ).data;
    personaNumber = lea.number;
    const epic = (
      await epics.createEpic.fetch({ params, body: { title: "Checkout" } }, as)
    ).data;
    const req = (
      await requirements.createRequirement.fetch(
        { params, body: { statement: "Orders are created" } },
        as,
      )
    ).data;
    requirementNumber = req.number;

    for (let i = 0; i < COUNT; i++) {
      const uc = (
        await useCases.createUseCase.fetch(
          {
            params,
            body: {
              title: `Use case ${i}`,
              actors: [{ personaId: lea.id }],
              steps: [{ actorPersonaId: lea.id, text: "Opens the page" }],
              alternatives: [{ key: "1a", text: "Signed out" }],
              criteria: [{ text: "The page opens" }],
            },
          },
          as,
        )
      ).data;
      await useCases.linkUseCaseEpic.fetch(
        {
          params: { id: uc.id },
          body: { epicNumber: epic.number, linked: true },
        },
        as,
      );
      await requirements.linkCriterion.fetch(
        {
          params,
          body: {
            useCaseNumber: uc.number,
            criterionKey: "C1",
            requirementNumber: req.number,
          },
        },
        as,
      );
      await runs.recordUseCaseRun.fetch(
        {
          params,
          body: {
            useCaseNumber: uc.number,
            by: "agent",
            client: "spec",
            env: "local",
            results: [{ key: "C1", result: "passed" }],
          },
        },
        as,
      );
    }
  }, 120_000);

  afterAll(async () => {
    await ctx.alepha.stop();
  });

  it("lists every use case with its scenario, runs and covering epic", async ({
    expect,
  }) => {
    const list = (
      await useCases.getUseCases.fetch(
        { params: { projectId: ctx.projectId }, query: {} },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(list).toHaveLength(COUNT);
    expect(list.every((it) => it.actors.length === 1)).toBe(true);
    expect(list.every((it) => it.steps.length === 1)).toBe(true);
    expect(list.every((it) => it.criteria.length === 1)).toBe(true);
    expect(list.every((it) => it.coveredBy.length === 1)).toBe(true);
    expect(list.every((it) => it.lastRun?.results.length === 1)).toBe(true);
  });

  it("reads one use case by number", async ({ expect }) => {
    const one = (
      await useCases.getUseCaseByNumber.fetch(
        { params: { projectId: ctx.projectId, number: COUNT } },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(one.title).toBe(`Use case ${COUNT - 1}`);
  });

  it("lists the requirement verified by every use case", async ({ expect }) => {
    const as = ctx.as(ctx.owner);
    const list = (
      await requirements.getRequirements.fetch(
        { params: { projectId: ctx.projectId }, query: {} },
        as,
      )
    ).data;
    expect(list).toHaveLength(1);
    const one = (
      await requirements.getRequirementByNumber.fetch(
        { params: { projectId: ctx.projectId, number: requirementNumber } },
        as,
      )
    ).data;
    expect(one.number).toBe(requirementNumber);
  });

  it("lists and reads the persona playing every use case", async ({
    expect,
  }) => {
    const as = ctx.as(ctx.owner);
    const list = (
      await personas.getPersonas.fetch(
        { params: { projectId: ctx.projectId }, query: {} },
        as,
      )
    ).data;
    expect(list).toHaveLength(1);
    const one = (
      await personas.getPersonaByNumber.fetch(
        { params: { projectId: ctx.projectId, number: personaNumber } },
        as,
      )
    ).data;
    expect(one.number).toBe(personaNumber);
  });

  it("reads the coverage, the impact and the persona insights", async ({
    expect,
  }) => {
    const as = ctx.as(ctx.owner);
    const projectId = ctx.projectId;
    const coverage = ctx.alepha.inject(RequirementCoverageController);
    const insights = ctx.alepha.inject(PersonaInsightController);
    await expect(
      coverage.getRequirementCoverage.fetch(
        { params: { projectId }, query: {} },
        as,
      ),
    ).resolves.toBeDefined();
    await expect(
      coverage.getRequirementImpact.fetch(
        { params: { projectId, number: requirementNumber } },
        as,
      ),
    ).resolves.toBeDefined();
    await expect(
      coverage.exportRequirements.fetch(
        { params: { projectId }, query: {} },
        as,
      ),
    ).resolves.toBeDefined();
    for (const read of [
      insights.getPersonaChanges,
      insights.getPersonaAppCopy,
      insights.getPersonaShowcase,
    ]) {
      await expect(
        read.fetch({ params: { projectId, number: personaNumber } }, as),
      ).resolves.toBeDefined();
    }
  });
});
