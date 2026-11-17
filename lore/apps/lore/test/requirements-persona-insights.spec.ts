import {
  PersonaController,
  PersonaInsightController,
  PersonaInsightService,
  RunController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { EpicController, QuestController } from "@lore/plan/api";
import { quests, releases } from "@lore/plan/schemas";
import { appInstances } from "@lore/ship/schemas";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { useCaseRuns } from "../../../packages/@lore/plan-requirements/src/api/entities/useCaseRuns.ts";
import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * A persona's scope changes, Open as, the showcase and evidence retention
 * (#E153, #Q3772).
 */
class InsightProbe {
  runs = $repository(useCaseRuns);
  releases = $repository(releases);
  quests = $repository(quests);
  copies = $repository(appInstances);
}

const ago = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

const video = (fileId: string) => ({
  fileId,
  name: "run.webm",
  mimeType: "video/webm",
  size: 10,
});

describe("persona insights", () => {
  let ctx: RequirementsProject;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setup = async () => {
    ctx = await requirementsProject({ probes: [InsightProbe] });
    const as = ctx.as(ctx.owner);
    const probe = ctx.alepha.inject(InsightProbe);
    const personas = ctx.alepha.inject(PersonaController);
    const useCases = ctx.alepha.inject(UseCaseController);
    const epics = ctx.alepha.inject(EpicController);
    const quests = ctx.alepha.inject(QuestController);
    const runs = ctx.alepha.inject(RunController);
    const insights = ctx.alepha.inject(PersonaInsightController);

    const persona = (
      await personas.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
        as,
      )
    ).data;
    const uc = (
      await useCases.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            title: "Check out",
            actors: [{ personaId: persona.id }],
            steps: [{ text: "Open the cart" }, { text: "Pay" }],
            criteria: [{ text: "An order exists" }],
          } as never,
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
    const quest = async (title: string, description = "", inEpic = true) => {
      const row = (
        await quests.createQuest.fetch(
          {
            body: {
              projectId: ctx.projectId,
              title,
              description,
              area: "shop",
              priority: "medium",
              size: 3,
            } as never,
          },
          as,
        )
      ).data;
      if (inEpic) {
        await epics.attachQuest.fetch(
          { params: { id: epic.id }, body: { questId: row.id } },
          as,
        );
      }
      return row;
    };
    const complete = async (id: number) => {
      await quests.acceptQuest.fetch({ params: { id } }, as);
      await quests.completeQuest.fetch(
        { params: { id }, body: {} as never },
        as,
      );
    };
    await useCases.linkUseCaseEpic.fetch(
      {
        params: { id: uc.id },
        body: { epicNumber: epic.number, linked: true },
      },
      as,
    );
    const record = async (daysAgo = 1) => {
      const { run } = (
        await runs.recordUseCaseRun.fetch(
          {
            params: { projectId: ctx.projectId },
            body: {
              useCaseNumber: uc.number,
              by: "agent",
              env: "local",
              results: [{ key: "C1", result: "passed" }],
            },
          },
          as,
        )
      ).data;
      await probe.runs.updateById(run.id, { ranAt: ago(daysAgo) });
      return run;
    };
    const params = { projectId: ctx.projectId, number: persona.number };
    const changes = async () =>
      (await insights.getPersonaChanges.fetch({ params }, as)).data;
    const appCopy = async () =>
      (await insights.getPersonaAppCopy.fetch({ params }, as)).data;
    const showcase = async () =>
      (await insights.getPersonaShowcase.fetch({ params }, as)).data;
    return {
      as,
      probe,
      persona,
      personas,
      uc,
      quest,
      complete,
      record,
      changes,
      appCopy,
      showcase,
    };
  };

  it("lists no change before the first run, then the quests completed since, via an epic or a mention", async ({
    expect,
  }) => {
    const t = await setup();
    const built = await t.quest("Build checkout");
    const later = await t.quest("Tweak checkout");
    const mentioned = await t.quest(
      "Fix the receipt for [[#A1]]",
      "Seen by [[#A1]]",
      false,
    );
    await t.complete(built.id);
    await t.probe.quests.updateById(built.id, { completedAt: ago(3) });
    expect((await t.changes()).changes).toEqual([]);
    expect((await t.changes()).releases[0].quests).toHaveLength(1);

    await t.record(2);
    await t.complete(later.id);
    await t.complete(mentioned.id);

    const read = await t.changes();
    expect(read.changes.map((it) => [it.questNumber, it.via])).toEqual(
      expect.arrayContaining([
        [later.shortId, "epic"],
        [mentioned.shortId, "mention"],
      ]),
    );
    expect(read.changes).toHaveLength(2);
    expect(read.toReverify).toBe(1);
    expect(read.releases.flatMap((it) => it.quests)).toHaveLength(3);
  });

  it("leads Open as to the persona's copy, never to production, and nowhere without one", async ({
    expect,
  }) => {
    const t = await setup();
    expect((await t.appCopy()).state).toBe("none");

    const edit = async (env: string) =>
      await t.personas.updatePersona.fetch(
        {
          params: { id: t.persona.id },
          body: { environmentApp: "acme", environmentEnv: env },
        },
        t.as,
      );
    await edit("staging");
    expect((await t.appCopy()).state).toBe("missing");

    await t.probe.copies.create({
      projectId: ctx.projectId,
      app: "acme",
      env: "staging",
      url: "https://staging.acme.example",
    } as never);
    expect(await t.appCopy()).toMatchObject({
      state: "ready",
      url: "https://staging.acme.example",
    });

    await edit("production");
    expect((await t.appCopy()).state).toBe("production");
    expect((await t.appCopy()).url).toBeUndefined();
  });

  it("keeps evidence for the current release and the three before, and the latest run of each, keeping every run", async ({
    expect,
  }) => {
    const t = await setup();
    // Five published releases, 50 to 10 days ago, then an open one.
    for (const [index, days] of [50, 40, 30, 20, 10].entries()) {
      await t.probe.releases.create({
        projectId: ctx.projectId,
        number: index + 1,
        tag: `0.${index + 1}.0`,
        title: `0.${index + 1}.0`,
        releasedAt: ago(days),
      } as never);
    }
    await t.probe.releases.create({
      projectId: ctx.projectId,
      number: 6,
      tag: "0.6.0",
      title: "0.6.0",
    } as never);

    const ids = [
      "00000000-0000-7000-8000-000000000001",
      "00000000-0000-7000-8000-000000000002",
      "00000000-0000-7000-8000-000000000003",
      "00000000-0000-7000-8000-000000000004",
    ];
    // In 0.1.0 (too old), twice in 0.6.0 (the older one goes), once in 0.3.0.
    const old = await t.record(55);
    const kept = await t.record(35);
    const superseded = await t.record(3);
    const latest = await t.record(1);
    for (const [run, fileId] of [
      [old, ids[0]],
      [kept, ids[1]],
      [superseded, ids[2]],
      [latest, ids[3]],
    ] as const) {
      await t.probe.runs.updateById(run.id, { evidence: [video(fileId)] });
    }

    const insights = ctx.alepha.inject(PersonaInsightService);
    expect(await insights.pruneEvidence(ctx.projectId)).toBe(2);
    const removed = async (id: number) =>
      !!(await t.probe.runs.findById(id))?.evidence[0]?.removedAt;
    expect(await removed(old.id)).toBe(true);
    expect(await removed(kept.id)).toBe(false);
    expect(await removed(superseded.id)).toBe(true);
    expect(await removed(latest.id)).toBe(false);
    expect(await insights.pruneEvidence(ctx.projectId)).toBe(0);

    const showcase = await t.showcase();
    expect(showcase.map((it) => it.release?.tag)).toEqual([
      "0.6.0",
      "0.3.0",
      "0.1.0",
    ]);
    expect(showcase[0].items[0]).toMatchObject({
      runId: latest.id,
      removed: false,
      file: { fileId: ids[3] },
    });
    expect(showcase[0].items[0].chapters.map((it) => it.text)).toEqual([
      "Open the cart",
      "Pay",
    ]);
    expect(showcase[2].items[0]).toMatchObject({
      runId: old.id,
      removed: true,
    });
  });
});
