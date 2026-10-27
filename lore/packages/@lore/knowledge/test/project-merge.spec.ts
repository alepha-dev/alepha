import { ProjectMergeService, type ProjectMergePlan } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm, SequenceProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { pinnedContentAtom } from "../src/api/atoms/pinnedContentAtom.ts";
import { LoreKnowledgeApi } from "../src/api/index.ts";
import { folioAttachments, folioNames } from "../src/schemas/index.ts";
import {
  createTestFolio,
  createTestProject,
  KnowledgeTestEntities,
} from "../src/testing/index.ts";

/**
 * Knowledge's bag plus the two tables this spec seeds by hand.
 */
class MergeTestEntities extends KnowledgeTestEntities {
  public readonly names = $repository(folioNames);
  public readonly attachments = $repository(folioAttachments);
}

interface TestContext {
  alepha: Alepha;
  merge: ProjectMergeService;
  sequences: SequenceProvider;
  repos: MergeTestEntities;
}

/**
 * Knowledge's step of a project merge (#E94, #Q2781, folio #F1401): folios,
 * directories and attachments move, a taken short id is renumbered, a root
 * name the target holds is suffixed, and the target's pin budget holds.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({ env: { DATABASE_URL: ":memory:" } });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreKnowledgeApi);
  const repos = alepha.inject(MergeTestEntities);
  await alepha.start();
  return {
    alepha,
    merge: alepha.inject(ProjectMergeService),
    sequences: alepha.inject(SequenceProvider),
    repos,
  };
};

const knowledgeOf = (plan: ProjectMergePlan) =>
  plan.steps.find((step) => step.name === "knowledge")!;

describe("ProjectMergeService, Knowledge's step", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const reserveRoot = (projectId: number, name: string, entityId: string) =>
    ctx.repos.names.create({
      parentDirectoryId: `root:${projectId}`,
      rootScope: String(projectId),
      lowerName: name.toLowerCase(),
      kind: "folio",
      entityId,
    });

  describe("short ids", () => {
    it("renumbers a taken folio, directory and attachment id, and keeps a free one", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      await createTestFolio(ctx.alepha, target, { shortId: 1355 });
      const taken = await createTestFolio(ctx.alepha, source, {
        shortId: 1355,
      });
      const free = await createTestFolio(ctx.alepha, source, {
        shortId: 64,
      });
      await ctx.repos.folioDirectories.create({
        projectId: target.id,
        shortId: 1,
        name: "a",
      });
      const directory = await ctx.repos.folioDirectories.create({
        projectId: source.id,
        shortId: 1,
        name: "b",
      });
      const attachment = (projectId: number, folioId: string) =>
        ctx.repos.attachments.create({
          fileId: crypto.randomUUID(),
          projectId,
          folioId,
          shortId: 1,
          name: "photo.webp",
        });
      const host = await createTestFolio(ctx.alepha, target, { shortId: 2 });
      await attachment(target.id, host.id);
      const blob = await attachment(source.id, free.id);

      const plan = await ctx.merge.merge(source.id, target.id);

      const knowledge = knowledgeOf(plan);
      expect(knowledge.renumbered).toEqual(
        expect.arrayContaining([
          { kind: "folio", id: taken.id, from: 1355, to: 1356 },
          { kind: "directory", id: directory.id, from: 1, to: 2 },
          { kind: "attachment", id: blob.fileId, from: 1, to: 2 },
        ]),
      );
      expect(knowledge.renumbered).toHaveLength(3);
      expect((await ctx.repos.folios.findById(free.id))!.shortId).toBe(64);
      expect((await ctx.repos.folios.findById(taken.id))!.projectId).toBe(
        target.id,
      );
      expect(await ctx.sequences.peek("folioShortId", String(target.id))).toBe(
        1356,
      );
      expect(
        (await ctx.repos.attachments.findById(blob.fileId))!.projectId,
      ).toBe(target.id);
    });
  });

  describe("root names", () => {
    it("suffixes a root folio whose name the target root holds, and moves the reservations", async ({
      expect,
    }) => {
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      const theirs = await createTestFolio(ctx.alepha, target, {
        shortId: 1,
        title: "Lore vocabulary",
      });
      await reserveRoot(target.id, "Lore vocabulary", theirs.id);
      const mine = await createTestFolio(ctx.alepha, source, {
        shortId: 2,
        title: "Lore vocabulary",
        summary: "Glossary",
      });
      await reserveRoot(source.id, "Lore vocabulary", mine.id);
      const other = await createTestFolio(ctx.alepha, source, {
        shortId: 3,
        title: "Bay runbook",
      });
      await reserveRoot(source.id, "Bay runbook", other.id);

      const plan = await ctx.merge.merge(source.id, target.id);

      expect(knowledgeOf(plan).changed).toEqual([
        {
          kind: "folio",
          id: mine.id,
          field: "title",
          from: "Lore vocabulary",
          to: "Lore vocabulary (1)",
        },
      ]);
      const renamed = (await ctx.repos.folios.findById(mine.id))!;
      expect(renamed.title).toBe("Lore vocabulary (1)");
      expect(renamed.searchText).toBe("lore vocabulary (1) glossary ");
      const reservations = await ctx.repos.names.findMany({
        where: { parentDirectoryId: { eq: `root:${target.id}` } },
      });
      expect(reservations.map((row) => row.lowerName).sort()).toEqual([
        "bay runbook",
        "lore vocabulary",
        "lore vocabulary (1)",
      ]);
      expect(
        await ctx.repos.names.findMany({
          where: { parentDirectoryId: { eq: `root:${source.id}` } },
        }),
      ).toEqual([]);
    });
  });

  describe("pins", () => {
    it("keeps a source pin that fits the target's budget and unpins one that does not", async ({
      expect,
    }) => {
      ctx.alepha.store.set(pinnedContentAtom, { maxChars: 300 });
      const target = await createTestProject(ctx.alepha);
      const source = await createTestProject(ctx.alepha);
      await createTestFolio(ctx.alepha, target, {
        shortId: 1,
        pinned: true,
        content: "x".repeat(200),
      });
      const fits = await createTestFolio(ctx.alepha, source, {
        shortId: 2,
        pinned: true,
        content: "y".repeat(80),
      });
      const overflows = await createTestFolio(ctx.alepha, source, {
        shortId: 3,
        pinned: true,
        content: "z".repeat(80),
      });

      const plan = await ctx.merge.merge(source.id, target.id);

      const unpinned = knowledgeOf(plan)
        .changed.filter((change) => change.field === "pinned")
        .map((change) => change.id);
      expect(unpinned).toHaveLength(1);
      const kept = unpinned[0] === fits.id ? overflows : fits;
      expect((await ctx.repos.folios.findById(kept.id))!.pinned).toBe(true);
      expect(
        (await ctx.repos.folios.findById(unpinned[0] as string))!.pinned,
      ).toBe(false);
    });
  });
});
