import {
  PersonaController,
  RequirementController,
  RequirementCoverageController,
  RequirementsPromptController,
  RunController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import {
  EpicController,
  QuestController,
  ReleaseController,
} from "@lore/plan/api";
import { afterEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Traceability (#E153, #Q3774): a release's readiness, the publish guard
 * behind Plan's `blockFailingMust`, the coverage gaps, technical epics, the
 * impact chain and the CSV export.
 */
describe("requirement traceability", () => {
  let ctx: RequirementsProject;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setup = async () => {
    ctx = await requirementsProject();
    const as = ctx.as(ctx.owner);
    const personas = ctx.alepha.inject(PersonaController);
    const useCases = ctx.alepha.inject(UseCaseController);
    const epics = ctx.alepha.inject(EpicController);
    const quests = ctx.alepha.inject(QuestController);
    const releases = ctx.alepha.inject(ReleaseController);
    const requirements = ctx.alepha.inject(RequirementController);
    const runs = ctx.alepha.inject(RunController);
    const coverage = ctx.alepha.inject(RequirementCoverageController);

    const lea = (
      await personas.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
        as,
      )
    ).data;
    await personas.createPersona.fetch(
      { params: { projectId: ctx.projectId }, body: { name: "Inès" } },
      as,
    );
    const release = (
      await releases.createRelease.fetch(
        { params: { projectId: ctx.projectId }, body: { tag: "2.4.0" } },
        as,
      )
    ).data;
    const epic = (
      await epics.createEpic.fetch(
        { params: { projectId: ctx.projectId }, body: { title: "Promotions" } },
        as,
      )
    ).data;
    await epics.setEpicStatus.fetch(
      { params: { id: epic.id }, body: { status: "ready" } },
      as,
    );
    await epics.updateEpic.fetch(
      { params: { id: epic.id }, body: { releaseId: release.id } },
      as,
    );
    const lonely = (
      await epics.createEpic.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { title: "Postgres move" },
        },
        as,
      )
    ).data;
    const quest = (
      await quests.createQuest.fetch(
        {
          body: {
            projectId: ctx.projectId,
            title: "Promo codes",
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
    const uc = (
      await useCases.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            title: "Apply a promo code",
            actors: [{ personaId: lea.id }],
            criteria: [{ text: "The discount shows" }],
          } as never,
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
    const must = (
      await requirements.createRequirement.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { statement: "The discount is visible", priority: "must" },
        },
        as,
      )
    ).data;
    await requirements.createRequirement.fetch(
      {
        params: { projectId: ctx.projectId },
        body: {
          statement: "Codes are, well, codes",
          priority: "should",
          chapter: "3. Promotions",
        },
      },
      as,
    );
    await requirements.linkCriterion.fetch(
      {
        params: { projectId: ctx.projectId },
        body: {
          useCaseNumber: uc.number,
          criterionKey: "C1",
          requirementNumber: must.number,
        },
      },
      as,
    );
    await quests.acceptQuest.fetch({ params: { id: quest.id } }, as);
    await quests.completeQuest.fetch(
      { params: { id: quest.id }, body: {} as never },
      as,
    );
    const fail = async () =>
      await runs.recordUseCaseRun.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            useCaseNumber: uc.number,
            by: "agent",
            env: "local",
            results: [{ key: "C1", result: "failed", note: "No discount" }],
          },
        },
        as,
      );
    const read = async (releaseId?: number) =>
      (
        await coverage.getRequirementCoverage.fetch(
          {
            params: { projectId: ctx.projectId },
            query: releaseId ? { releaseId } : {},
          },
          as,
        )
      ).data;
    return {
      as,
      release,
      epic,
      lonely,
      uc,
      must,
      fail,
      read,
      releases,
      coverage,
    };
  };

  it("counts a release's readiness and names its failing Musts", async ({
    expect,
  }) => {
    const t = await setup();
    await t.fail();
    const read = await t.read(t.release.id);
    expect(read.release?.tag).toBe("2.4.0");
    expect(read.must).toEqual({ verified: 0, total: 1 });
    expect(read.failingMust).toEqual([
      { number: t.must.number, statement: "The discount is visible" },
    ]);
    expect(read.blocking).toBe(false);
  });

  it("refuses to publish a release with a failing Must only when the project says so", async ({
    expect,
  }) => {
    const t = await setup();
    await t.fail();
    await ctx.setPlan({
      epics: true,
      releases: true,
      requirements: true,
      blockFailingMust: true,
    });
    expect((await t.read(t.release.id)).blocking).toBe(true);
    expect(
      await ctx.statusOf(
        t.releases.publishRelease.fetch(
          { params: { id: t.release.id }, body: {} },
          t.as,
        ),
      ),
    ).toBe(409);

    await ctx.setPlan({ epics: true, releases: true, requirements: true });
    expect(
      await ctx.statusOf(
        t.releases.publishRelease.fetch(
          { params: { id: t.release.id }, body: {} },
          t.as,
        ),
      ),
    ).toBe(200);
  });

  it("lists the gaps, and a technical epic leaves them", async ({ expect }) => {
    const t = await setup();
    const read = await t.read();
    expect(
      read.gaps.requirementsNotVerified.map((it) => it.number),
    ).toHaveLength(2);
    expect(read.gaps.useCasesWithoutRequirement).toEqual([]);
    expect(
      read.gaps.personasWithoutPassingUseCase.map((it) => it.name),
    ).toEqual(["Léa", "Inès"]);
    expect(read.gaps.epicsWithoutUseCase.map((it) => it.number)).toEqual([
      t.lonely.number,
    ]);

    await t.coverage.setEpicTechnical.fetch(
      {
        params: { projectId: ctx.projectId },
        body: { epicNumber: t.lonely.number, technical: true },
      },
      t.as,
    );
    expect((await t.read()).gaps.epicsWithoutUseCase).toEqual([]);
  });

  it("follows a requirement to its use cases, epics, quests and errors", async ({
    expect,
  }) => {
    const t = await setup();
    await t.fail();
    const impact = (
      await t.coverage.getRequirementImpact.fetch(
        { params: { projectId: ctx.projectId, number: t.must.number } },
        t.as,
      )
    ).data;
    expect(impact.useCases).toEqual([
      {
        number: t.uc.number,
        title: "Apply a promo code",
        stale: false,
        criteria: [{ key: "C1", result: "failed" }],
      },
    ]);
    expect(impact.epics).toEqual([
      { number: t.epic.number, title: "Promotions", done: 1, total: 1 },
    ]);
    expect(impact.quests.map((it) => it.title)).toEqual(["Promo codes"]);
    expect(impact.errors).toHaveLength(1);
  });

  it("exports the requirements as CSV", async ({ expect }) => {
    const t = await setup();
    const res = await t.coverage.exportRequirements.fetch(
      { params: { projectId: ctx.projectId }, query: {} },
      t.as,
    );
    const text = await (res.data as unknown as Blob).text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe(
      "number,chapter,paragraph,statement,type,priority,status,release,verified_by",
    );
    expect(lines).toHaveLength(3);
    expect(text).toContain('"Codes are, well, codes"');
    expect(text).toContain(`U${t.uc.number} C1`);
  });

  it("renders the useCaseDraft prompt for a requirement and for an epic", async ({
    expect,
  }) => {
    const t = await setup();
    const prompts = ctx.alepha.inject(RequirementsPromptController);
    const forRequirement = (
      await prompts.renderRequirementsPrompt.fetch(
        {
          params: { projectId: ctx.projectId },
          query: { kind: "useCaseDraft", requirementNumber: t.must.number },
        },
        t.as,
      )
    ).data;
    expect(forRequirement.prompt).toContain(`#S${t.must.number}`);
    expect(forRequirement.prompt).toContain("The discount is visible");
    expect(forRequirement.command).toContain(
      `--requirement S${t.must.number} --mode draft`,
    );
    const forEpic = (
      await prompts.renderRequirementsPrompt.fetch(
        {
          params: { projectId: ctx.projectId },
          query: { kind: "useCaseDraft", epicNumber: t.lonely.number },
        },
        t.as,
      )
    ).data;
    expect(forEpic.prompt).toContain(`#E${t.lonely.number}`);
    expect(forEpic.command).toContain(`--epic E${t.lonely.number}`);
  });
});
