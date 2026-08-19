import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { LoreApi } from "../index.ts";
import { AreaService } from "./AreaService.ts";
import { QuestService } from "./QuestService.ts";

interface TestContext {
  alepha: Alepha;
  service: AreaService;
  repos: TestEntityRepositories;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config — the one CI
 * runs — sets `DATABASE_URL` to a Postgres URL, which this app's SQLite
 * provider rejects outright. A bare `Alepha.create()` passes under
 * `yarn w lore test` and fails under `yarn test`.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return { alepha, service: alepha.inject(AreaService), repos };
};

describe("AreaService", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates an area the first time a name is seen, and only once", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);

    const first = await ctx.service.ensureArea(project.id, "alepha/orm");
    const second = await ctx.service.ensureArea(project.id, "alepha/orm");

    expect(first?.id).toBe(second?.id);

    const all = await ctx.service.listWithStats(project.id);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("alepha/orm");
  });

  it("ignores an empty area name", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);

    expect(await ctx.service.ensureArea(project.id, "")).toBeUndefined();
    expect(await ctx.service.ensureArea(project.id, "   ")).toBeUndefined();
    expect(await ctx.service.listWithStats(project.id)).toHaveLength(0);
  });

  it("treats names as case-sensitive until they are merged", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);

    await ctx.service.ensureArea(project.id, "Folio");
    await ctx.service.ensureArea(project.id, "folio");

    expect(await ctx.service.listWithStats(project.id)).toHaveLength(2);
  });

  it("counts open quests apart from the total", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    await ctx.service.ensureArea(project.id, "alepha/orm");

    await createTestQuest(ctx.alepha, project, { area: "alepha/orm" });
    await createTestQuest(ctx.alepha, project, {
      area: "alepha/orm",
      completedAt: new Date().toISOString(),
    });
    await createTestQuest(ctx.alepha, project, {
      area: "alepha/orm",
      shelvedAt: new Date().toISOString(),
    });

    const [stats] = await ctx.service.listWithStats(project.id);
    expect(stats.questCount).toBe(3);
    expect(stats.openQuestCount).toBe(1);
    expect(stats.firstQuestAt).toBeDefined();
    expect(stats.lastQuestAt).toBeDefined();
  });

  it("renames in place when the target name is free", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const area = await ctx.service.ensureArea(project.id, "ui");
    const quest = await createTestQuest(ctx.alepha, project, {
      area: "ui",
    });

    const result = await ctx.service.rename(area!.id, "@alepha/ui");

    expect(result.merged).toBe(false);
    expect(result.movedQuests).toBe(1);
    expect(result.area.name).toBe("@alepha/ui");

    const reloaded = await ctx.repos.quests.getById(quest.id);
    expect(reloaded.area).toBe("@alepha/ui");
  });

  it("merges when the target name already exists", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const source = await ctx.service.ensureArea(project.id, "folio");
    await ctx.service.ensureArea(project.id, "Folio");

    const quest = await createTestQuest(ctx.alepha, project, {
      area: "folio",
    });

    const result = await ctx.service.rename(source!.id, "Folio");

    expect(result.merged).toBe(true);
    expect(result.movedQuests).toBe(1);

    const reloaded = await ctx.repos.quests.getById(quest.id);
    expect(reloaded.area).toBe("Folio");

    const all = await ctx.service.listWithStats(project.id);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Folio");
    expect(all[0].questCount).toBe(1);
  });

  it("merges many sources into one target", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const a = await ctx.service.ensureArea(project.id, "cli");
    const b = await ctx.service.ensureArea(project.id, "CLI");
    const target = await ctx.service.ensureArea(project.id, "alepha/cli");

    await createTestQuest(ctx.alepha, project, { area: "cli" });
    await createTestQuest(ctx.alepha, project, { area: "CLI" });

    const result = await ctx.service.merge(
      project.id,
      [a!.id, b!.id],
      target!.id,
    );

    expect(result.movedQuests).toBe(2);

    const all = await ctx.service.listWithStats(project.id);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("alepha/cli");
    expect(all[0].questCount).toBe(2);
  });

  it("an area merged away can be declared again by a new quest", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const source = await ctx.service.ensureArea(project.id, "cli");
    const target = await ctx.service.ensureArea(project.id, "alepha/cli");

    await ctx.service.merge(project.id, [source!.id], target!.id);

    // `cli` was soft-deleted by the merge above. If it were merely
    // stamped `deletedAt` rather than physically removed, it would still
    // occupy the `(projectId, "cli")` slot in the unique index — which
    // has no `WHERE deleted_at IS NULL` clause — and this `create` would
    // throw a unique-constraint error instead of succeeding.
    const revived = await ctx.service.ensureArea(project.id, "cli");
    expect(revived).toBeDefined();
    expect(revived?.name).toBe("cli");

    const all = await ctx.service.listWithStats(project.id);
    const names = all.map((a) => a.name).sort();
    expect(names).toEqual(["alepha/cli", "cli"]);
  });

  it("refuses to merge an area into itself", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const area = await ctx.service.ensureArea(project.id, "docs");

    await expect(
      ctx.service.merge(project.id, [area!.id], area!.id),
    ).rejects.toThrowError();
  });

  it("refuses to merge across projects", async ({ expect }) => {
    const one = await createTestProject(ctx.alepha);
    const two = await createTestProject(ctx.alepha);
    const source = await ctx.service.ensureArea(one.id, "docs");
    const target = await ctx.service.ensureArea(two.id, "docs");

    await expect(
      ctx.service.merge(one.id, [source!.id], target!.id),
    ).rejects.toThrowError();
  });

  it("leaves other projects' quests untouched when merging", async ({
    expect,
  }) => {
    const mine = await createTestProject(ctx.alepha);
    const theirs = await createTestProject(ctx.alepha);

    const source = await ctx.service.ensureArea(mine.id, "ui");
    const target = await ctx.service.ensureArea(mine.id, "@alepha/ui");
    await ctx.service.ensureArea(theirs.id, "ui");

    const foreign = await createTestQuest(ctx.alepha, theirs, {
      area: "ui",
    });

    await ctx.service.merge(mine.id, [source!.id], target!.id);

    const reloaded = await ctx.repos.quests.getById(foreign.id);
    expect(reloaded.area).toBe("ui");
  });

  it("registers a new area when a quest declares one", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const questService = ctx.alepha.inject(QuestService);

    await questService.createQuest(project, {
      projectId: project.id,
      title: "Streaming ZIP writer",
      description: "",
      area: "alepha/system",
      createdBy: project.createdBy,
    });

    const all = await ctx.service.listWithStats(project.id);
    expect(all.map((a) => a.name)).toContain("alepha/system");
    expect(all.find((a) => a.name === "alepha/system")?.questCount).toBe(1);
  });
});
