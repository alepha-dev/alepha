import {
  RequirementController,
  RunController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { EpicController, QuestController } from "@lore/plan/api";
import { projectErrors } from "@lore/ship/schemas";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Runs of a use case (#E153, #Q3770): one result per criterion, staleness
 * computed from the covering quests and the scenario version, and the error
 * rule: a failed criterion opens an error only once every covering quest is
 * done and the project tracks errors; one per criterion, resolved by a pass.
 */
class ErrorProbe {
  errors = $repository(projectErrors);
}

describe("use case runs", () => {
  let ctx: RequirementsProject;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setup = async (options: { track?: boolean } = {}) => {
    ctx = await requirementsProject({ probes: [ErrorProbe] });
    if (options.track === false) {
      const { ProjectCapabilityController } = await import("@lore/core/api");
      await ctx.alepha.inject(ProjectCapabilityController).setCapability.fetch(
        {
          params: { projectId: ctx.projectId, key: "ship" },
          body: { enabled: true, options: { track: false } },
        },
        ctx.as(ctx.owner),
      );
    }
    const as = ctx.as(ctx.owner);
    const useCases = ctx.alepha.inject(UseCaseController);
    const epics = ctx.alepha.inject(EpicController);
    const quests = ctx.alepha.inject(QuestController);
    const runs = ctx.alepha.inject(RunController);
    const requirements = ctx.alepha.inject(RequirementController);

    const uc = (
      await useCases.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            title: "Check out",
            criteria: [
              { text: "An order exists" },
              { text: "A receipt is mailed" },
            ],
          },
        },
        as,
      )
    ).data;
    const epic = (
      await epics.createEpic.fetch(
        { params: { projectId: ctx.projectId }, body: { title: "Checkout" } },
        as,
      )
    ).data;
    await epics.setEpicStatus.fetch(
      { params: { id: epic.id }, body: { status: "ready" } },
      as,
    );
    const quest = (
      await quests.createQuest.fetch(
        {
          body: {
            projectId: ctx.projectId,
            title: "Build checkout",
            area: "shop",
            priority: "medium",
            size: 3,
          } as never,
        },
        as,
      )
    ).data;
    await epics.attachQuest.fetch(
      { params: { id: epic.id }, body: { questId: quest.id } },
      as,
    );
    await useCases.linkUseCaseEpic.fetch(
      {
        params: { id: uc.id },
        body: { epicNumber: epic.number, linked: true },
      },
      as,
    );
    const req = (
      await requirements.createRequirement.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { statement: "Orders are created" },
        },
        as,
      )
    ).data;
    await requirements.linkCriterion.fetch(
      {
        params: { projectId: ctx.projectId },
        body: {
          useCaseNumber: uc.number,
          criterionKey: "C1",
          requirementNumber: req.number,
        },
      },
      as,
    );

    const record = async (c1: "passed" | "failed", c2?: "passed" | "failed") =>
      (
        await runs.recordUseCaseRun.fetch(
          {
            params: { projectId: ctx.projectId },
            body: {
              useCaseNumber: uc.number,
              by: "agent",
              client: "spec",
              env: "local",
              results: [
                {
                  key: "C1",
                  result: c1,
                  note: c1 === "failed" ? "No order" : undefined,
                },
                ...(c2 ? [{ key: "C2", result: c2 }] : []),
              ],
            },
          },
          as,
        )
      ).data;
    const complete = async () => {
      await quests.acceptQuest.fetch({ params: { id: quest.id } }, as);
      await quests.completeQuest.fetch(
        { params: { id: quest.id }, body: {} as never },
        as,
      );
    };
    const read = async () =>
      (
        await useCases.getUseCaseByNumber.fetch(
          { params: { projectId: ctx.projectId, number: uc.number } },
          as,
        )
      ).data;
    const status = async () =>
      (
        await requirements.getRequirementByNumber.fetch(
          { params: { projectId: ctx.projectId, number: req.number } },
          as,
        )
      ).data.status;
    return { uc, record, complete, read, status, useCases, as };
  };

  it("records every criterion, a missing one as not run, and reads the latest run", async ({
    expect,
  }) => {
    const t = await setup();
    const recorded = await t.record("passed");
    expect(recorded.run.results).toEqual([
      { criterionKey: "C1", result: "passed" },
      { criterionKey: "C2", result: "not_run" },
    ]);
    const uc = await t.read();
    expect(uc.state).toBe("passed");
    expect(uc.lastRun?.results.map((it) => it.result)).toEqual([
      "passed",
      "not_run",
    ]);
    expect(await t.status()).toBe("verified");
  });

  it("keeps a failure in development while a covering quest is open, and opens nothing", async ({
    expect,
  }) => {
    const t = await setup();
    const recorded = await t.record("failed");
    expect(recorded.errorRule).toBe("in_development");
    expect(recorded.errorsOpened).toBe(0);
    expect((await t.read()).state).toBe("in_development");
    expect(await t.status()).toBe("in_development");
  });

  it("opens one error per failing criterion once the quests are done, bumps it, and resolves it on a pass", async ({
    expect,
  }) => {
    const t = await setup();
    await t.complete();
    const errors = ctx.alepha.inject(ErrorProbe).errors;

    const first = await t.record("failed", "passed");
    expect(first.errorRule).toBe("opened");
    expect((await t.read()).state).toBe("failed");
    expect(await t.status()).toBe("failing");
    await t.record("failed");
    const rows = await errors.findMany({
      where: { projectId: { eq: ctx.projectId } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fingerprint: `usecase:${t.uc.id}:C1`,
      origin: "run",
      criterionKey: "C1",
      count: 2,
      status: "open",
    });

    await t.record("passed");
    const [resolved] = await errors.findMany({
      where: { projectId: { eq: ctx.projectId } },
    });
    expect(resolved.status).toBe("resolved");
    expect(await t.status()).toBe("verified");
  });

  it("opens no error without Ship's track, and shows Failing", async ({
    expect,
  }) => {
    const t = await setup({ track: false });
    await t.complete();
    const recorded = await t.record("failed");
    expect(recorded.errorRule).toBe("no_inbox");
    expect(recorded.errorsOpened).toBe(0);
    expect((await t.read()).state).toBe("failed");
  });

  it("goes stale when a covering quest completes after the run, or the scenario moves", async ({
    expect,
  }) => {
    const t = await setup();
    await t.record("passed");
    expect((await t.read()).stale).toBe(false);
    await t.complete();
    expect((await t.read()).stale).toBe(true);

    await t.record("passed");
    expect((await t.read()).stale).toBe(false);
    await t.useCases.updateUseCase.fetch(
      {
        params: { id: t.uc.id },
        body: {
          criteria: [{ key: "C1", text: "An order exists" }, { text: "New" }],
        },
      },
      t.as,
    );
    expect((await t.read()).stale).toBe(true);
  });

  it("records over MCP", async ({ expect }) => {
    const t = await setup();
    const token = await ctx.tokenOf(ctx.owner);
    const recorded = await ctx.mcp(token, "usecase_run_record", {
      number: t.uc.number,
      by: "agent",
      client: "claude-code",
      results: [{ key: "C1", result: "passed" }],
    });
    expect(recorded.refused).toBe(false);
    expect(recorded.text).toContain("runId");
  });
});
