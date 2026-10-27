import { type ProjectMergePlan, ProjectMergeService } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm, SequenceProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreWorkApi } from "../src/api/index.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  WorkTestEntities,
} from "../src/testing/index.ts";

const workOf = (plan: ProjectMergePlan) =>
  plan.steps.find((step) => step.name === "work")!;

interface TestContext {
  alepha: Alepha;
  merge: ProjectMergeService;
  sequences: SequenceProvider;
  repos: WorkTestEntities;
}

/**
 * Work's step of a project merge (#E94, #Q2780, folio #F1401): what moves,
 * what keeps its number, what is renumbered and what is joined to a row the
 * target already has.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({ env: { DATABASE_URL: ":memory:" } });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreWorkApi);
  const repos = alepha.inject(WorkTestEntities);
  await alepha.start();
  return {
    alepha,
    merge: alepha.inject(ProjectMergeService),
    sequences: alepha.inject(SequenceProvider),
    repos,
  };
};

describe("ProjectMergeService, Work's step", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const shortIdsOf = async (projectId: number) =>
    (
      await ctx.repos.quests.findMany({
        where: { projectId: { eq: projectId } },
      })
    )
      .map((quest) => quest.shortId)
      .sort((a, b) => a - b);

  describe("quests", () => {
    it("keeps a free number and renumbers a taken one above both projects and the sequence", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      await createTestQuest(ctx.alepha, target, { shortId: 1 });
      await createTestQuest(ctx.alepha, target, { shortId: 2 });
      await ctx.sequences.reset("questShortId", String(target.id), 5);
      const taken = await createTestQuest(ctx.alepha, source, { shortId: 2 });
      await createTestQuest(ctx.alepha, source, { shortId: 3 });
      await createTestQuest(ctx.alepha, source, { shortId: 9 });

      const plan = await ctx.merge.merge(source.id, target.id);

      const work = workOf(plan);
      expect(work.moved.quests).toBe(3);
      expect(work.renumbered.filter((r) => r.kind === "quest")).toEqual([
        { kind: "quest", id: taken.id, from: 2, to: 10 },
      ]);
      expect(await shortIdsOf(target.id)).toEqual([1, 2, 3, 9, 10]);
      expect(await shortIdsOf(source.id)).toEqual([]);
      expect(await ctx.sequences.peek("questShortId", String(target.id))).toBe(
        10,
      );
    });

    it("counts a soft-deleted target quest as taken", async ({ expect }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      const gone = await createTestQuest(ctx.alepha, target, { shortId: 4 });
      await ctx.repos.quests.deleteById(gone.id);
      await createTestQuest(ctx.alepha, source, { shortId: 4 });

      const plan = await ctx.merge.merge(source.id, target.id);

      expect(workOf(plan).renumbered).toEqual([
        expect.objectContaining({ kind: "quest", from: 4, to: 5 }),
      ]);
      expect(await shortIdsOf(target.id)).toEqual([5]);
    });

    it("writes nothing on a dry run, and answers the same plan", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      await createTestQuest(ctx.alepha, target, { shortId: 1 });
      await createTestQuest(ctx.alepha, source, { shortId: 1 });

      const dry = await ctx.merge.merge(source.id, target.id, { dryRun: true });

      expect(dry.dryRun).toBe(true);
      expect(await shortIdsOf(source.id)).toEqual([1]);
      expect(await shortIdsOf(target.id)).toEqual([1]);
      expect(
        await ctx.sequences.peek("questShortId", String(target.id)),
      ).toBeNull();

      const real = await ctx.merge.merge(source.id, target.id);

      expect(real.steps).toEqual(dry.steps);
      expect(await shortIdsOf(target.id)).toEqual([1, 2]);
    });

    it("renumbers against what an earlier merge brought in", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const lore = await createTestProject(ctx.alepha);
      const bay = await createTestProject(ctx.alepha);
      await createTestQuest(ctx.alepha, lore, { shortId: 5 });
      await createTestQuest(ctx.alepha, bay, { shortId: 5 });

      await ctx.merge.merge(lore.id, target.id);
      const plan = await ctx.merge.merge(bay.id, target.id);

      expect(workOf(plan).renumbered).toEqual([
        expect.objectContaining({ kind: "quest", from: 5, to: 6 }),
      ]);
      expect(await shortIdsOf(target.id)).toEqual([5, 6]);
    });
  });

  describe("epics and feedback", () => {
    it("renumbers a taken epic number and feedback id, and a quest keeps its epic", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      await createTestEpic(ctx.alepha, target, { number: 73 });
      const epic = await createTestEpic(ctx.alepha, source, { number: 73 });
      const quest = await createTestQuest(ctx.alepha, source, {
        shortId: 1,
        epicId: epic.id,
      });
      const feedback = (projectId: number) =>
        ctx.repos.feedback.create({
          projectId,
          shortId: 1,
          title: "A report",
          description: "",
          status: "pending",
        });
      await feedback(target.id);
      const moved = await feedback(source.id);

      const plan = await ctx.merge.merge(source.id, target.id);

      expect(workOf(plan).renumbered).toEqual(
        expect.arrayContaining([
          { kind: "epic", id: epic.id, from: 73, to: 74 },
          { kind: "feedback", id: moved.id, from: 1, to: 2 },
        ]),
      );
      const after = (await ctx.repos.quests.findById(quest.id))!;
      expect(after.projectId).toBe(target.id);
      expect(after.epicId).toBe(epic.id);
      expect((await ctx.repos.epics.findById(epic.id))!.number).toBe(74);
      expect(
        await ctx.sequences.peek("feedbackShortId", String(target.id)),
      ).toBe(2);
    });
  });

  describe("releases", () => {
    it("joins a release by tag and moves the others, keeping the target's default", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      const now = new Date().toISOString();
      const release = (
        projectId: number,
        number: number,
        tag: string,
        isDefault: boolean,
      ) =>
        ctx.repos.releases.create({
          projectId,
          number,
          tag,
          title: tag,
          defaultSince: isDefault ? now : undefined,
        });
      const kept = await release(target.id, 1, "0.33.0", true);
      const joined = await release(source.id, 1, "0.33.0", false);
      const other = await release(source.id, 2, "0.40.0", true);
      const quest = await createTestQuest(ctx.alepha, source, {
        shortId: 1,
        releaseId: joined.id,
      });
      const epic = await createTestEpic(ctx.alepha, source, {
        number: 1,
        releaseId: joined.id,
      });

      const plan = await ctx.merge.merge(source.id, target.id);

      const work = workOf(plan);
      expect(work.joined).toContainEqual({
        kind: "release",
        key: "0.33.0",
        sourceId: joined.id,
        targetId: kept.id,
      });
      expect(work.moved.releases).toBe(1);
      expect((await ctx.repos.quests.findById(quest.id))!.releaseId).toBe(
        kept.id,
      );
      expect((await ctx.repos.epics.findById(epic.id))!.releaseId).toBe(
        kept.id,
      );
      expect(
        await ctx.repos.releases.findMany({
          where: { id: { eq: joined.id } },
        }),
      ).toEqual([]);
      const moved = (await ctx.repos.releases.findById(other.id))!;
      expect(moved.projectId).toBe(target.id);
      expect(moved.number).toBe(2);
      expect(moved.defaultSince).toBeUndefined();
      expect((await ctx.repos.releases.findById(kept.id))!.defaultSince).toBe(
        now,
      );
    });

    it("renumbers a moved release whose number is taken", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      await ctx.repos.releases.create({
        projectId: target.id,
        number: 1,
        tag: "1.0.0",
        title: "1.0.0",
      });
      const moved = await ctx.repos.releases.create({
        projectId: source.id,
        number: 1,
        tag: "2.0.0",
        title: "2.0.0",
      });

      const plan = await ctx.merge.merge(source.id, target.id);

      expect(workOf(plan).renumbered).toEqual([
        { kind: "release", id: moved.id, from: 1, to: 2 },
      ]);
      expect((await ctx.repos.releases.findById(moved.id))!.number).toBe(2);
    });
  });

  describe("areas", () => {
    it("joins an area by name, bringing a deleted target row back, and moves the others", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      const dormant = await ctx.repos.areas.create({
        projectId: target.id,
        name: "lore/api",
      });
      await ctx.repos.areas.deleteById(dormant.id);
      await ctx.repos.areas.create({ projectId: source.id, name: "lore/api" });
      await ctx.repos.areas.create({ projectId: source.id, name: "bay" });

      const plan = await ctx.merge.merge(source.id, target.id);

      expect(workOf(plan).moved.areas).toBe(1);
      const names = (
        await ctx.repos.areas.findMany({
          where: { projectId: { eq: target.id } },
        })
      )
        .map((area) => area.name)
        .sort();
      expect(names).toEqual(["bay", "lore/api"]);
      expect(
        await ctx.repos.areas.findMany({
          where: { projectId: { eq: source.id } },
        }),
      ).toEqual([]);
    });
  });

  describe("refusals", () => {
    it("refuses a project merged into itself, and a project that does not exist", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);

      await expect(ctx.merge.merge(project.id, project.id)).rejects.toThrow(
        /into itself/,
      );
      await expect(ctx.merge.merge(999_999, project.id)).rejects.toThrow(
        /No project 999999/,
      );
    });
  });
});
