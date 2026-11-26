import { ProjectController, ProjectMergeService } from "@lore/core/api";
import { comments } from "@lore/core/schemas";
import {
  PersonaController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { $repository } from "alepha/orm";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

class Probe {
  comments = $repository(comments);
}

/**
 * A persona's and a use case's discussion on core's `comments` (#E185):
 * where the rows land, the agent mark read back from `source`, what a
 * subject's delete leaves, and the threads following their project through
 * a merge, now moved by core.
 */
describe("persona and use case comments on core's comments", () => {
  let ctx: RequirementsProject;
  let personas: PersonaController;
  let useCases: UseCaseController;
  let probe: Probe;

  beforeEach(async () => {
    ctx = await requirementsProject({ probes: [Probe] });
    personas = ctx.alepha.inject(PersonaController);
    useCases = ctx.alepha.inject(UseCaseController);
    probe = ctx.alepha.inject(Probe);
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const world = async () => {
    const lea = (
      await personas.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
        ctx.as(ctx.owner),
      )
    ).data;
    const checkout = (
      await useCases.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { title: "Check out", criteria: [{ text: "An order exists" }] },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    await personas.addPersonaComment.fetch(
      { params: { id: lea.id }, body: { body: "Interviewed on Monday" } },
      ctx.as(ctx.owner),
    );
    await useCases.addUseCaseComment.fetch(
      {
        params: { id: checkout.id },
        body: { body: "Step 3 fails", agent: true, agentClient: "claude-code" },
      },
      ctx.as(ctx.owner),
    );
    await useCases.addUseCaseComment.fetch(
      { params: { id: checkout.id }, body: { body: "No name", agent: true } },
      ctx.as(ctx.owner),
    );
    return { lea, checkout };
  };

  it("writes each comment under its subject, and reads an agent's back with its mark", async ({
    expect,
  }) => {
    const { lea, checkout } = await world();

    expect(
      await probe.comments.findMany({
        orderBy: [{ column: "id", direction: "asc" }],
      }),
    ).toMatchObject([
      {
        projectId: ctx.projectId,
        subjectType: "persona",
        subjectId: lea.id,
        authorId: ctx.owner,
        body: "Interviewed on Monday",
      },
      {
        projectId: ctx.projectId,
        subjectType: "usecase",
        subjectId: checkout.id,
        body: "Step 3 fails",
        source: { kind: "mcp", client: "claude-code" },
      },
      {
        subjectType: "usecase",
        subjectId: checkout.id,
        body: "No name",
        source: { kind: "mcp" },
      },
    ]);

    // The wire has not changed: `subjectKind`, `byAgent`, `agentClient`.
    const onPersona = (
      await personas.getPersonaComments.fetch(
        { params: { projectId: ctx.projectId, number: lea.number } },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(onPersona).toMatchObject([
      { subjectKind: "persona", subjectId: lea.id, projectId: ctx.projectId },
    ]);
    expect(onPersona[0]?.byAgent).toBeUndefined();
    expect(onPersona[0]?.agentClient).toBeUndefined();
    const onUseCase = (
      await useCases.getUseCaseComments.fetch(
        { params: { projectId: ctx.projectId, number: checkout.number } },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(
      onUseCase.map((it) => [it.body, it.byAgent, it.agentClient]),
    ).toEqual([
      ["Step 3 fails", true, "claude-code"],
      ["No name", true, undefined],
    ]);
  });

  it("leaves no comment behind a deleted persona, and keeps the use case's", async ({
    expect,
  }) => {
    const { lea } = await world();

    await personas.deletePersona.fetch(
      { params: { id: lea.id } },
      ctx.as(ctx.owner),
    );

    expect(
      (await probe.comments.findMany()).map((comment) => comment.subjectType),
    ).toEqual(["usecase", "usecase"]);
  });

  it("moves both threads with their project in a merge, through core's step", async ({
    expect,
  }) => {
    await world();
    const target = (
      await ctx.alepha
        .inject(ProjectController)
        .createProject.fetch(
          { body: { title: "Target" } as never },
          ctx.as(ctx.owner),
        )
    ).data;

    const plan = await ctx.alepha
      .inject(ProjectMergeService)
      .merge(ctx.projectId, target.id);

    expect(
      (await probe.comments.findMany()).map((comment) => comment.projectId),
    ).toEqual([target.id, target.id, target.id]);
    expect(
      plan.steps.find((step) => step.name === "core")!.moved,
    ).toMatchObject({ comments: 3 });
    // Requirements' own step moves its tables, and no longer the threads.
    expect(
      plan.steps.find((step) => step.name === "requirements")!.moved,
    ).not.toHaveProperty("requirements_comments");
  });
});
