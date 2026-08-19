import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, BadRequestError, ForbiddenError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  createTestEpic,
  createTestFolio,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { LoreApi } from "../index.ts";
import { EpicController } from "./EpicController.ts";

interface TestContext {
  alepha: Alepha;
  controller: EpicController;
  repos: TestEntityRepositories;
  dt: DateTimeProvider;
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

  // Registered before `start()` — the exact instance later `inject()` calls
  // must hit, so the FK closure `EpicController`'s fixtures reach (projects,
  // users, folioDirectories, ...) is known to the schema sync before boot.
  // See the comment on `TestEntityRepositories`.
  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(EpicController),
    repos,
    dt: alepha.inject(DateTimeProvider),
  };
};

/**
 * A plain, non-DB-backed token is enough: `$secure`'s `action.run()` path
 * reads `options.user` straight off the object (no DB lookup), and the
 * default "user" role grants every non-`admin:*` permission with
 * `ownership: true` — which is what makes `ProjectSecurityService`'s
 * `assertOwner`/`assertMember` actually compare `project.createdBy` to
 * `user.id` instead of bypassing the check.
 */
const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

const strangerToken = (): UserAccountToken => ({
  id: crypto.randomUUID(),
  roles: ["user"],
});

describe("EpicController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("allocates per-project epic numbers from 1", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);

    const first = await ctx.controller.createEpic(
      { params: { projectId: project.id }, body: { title: "Lore Deploy" } },
      { user },
    );
    const second = await ctx.controller.createEpic(
      { params: { projectId: project.id }, body: { title: "Second" } },
      { user },
    );

    expect([first.number, second.number]).toEqual([1, 2]);
  });

  it("creates an epic in `planned`", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);

    const epic = await ctx.controller.createEpic(
      { params: { projectId: project.id }, body: { title: "Lore Deploy" } },
      { user },
    );

    expect(epic.status).toBe("planned");
  });

  it("stamps activatedAt when the epic begins, and writes to no quest row", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "planned",
    });
    const quest = await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
    });
    const before = (await ctx.repos.quests.getById(quest.id)).updatedAt;

    const updated = await ctx.controller.setEpicStatus(
      { params: { id: epic.id }, body: { status: "active" } },
      { user },
    );

    expect(updated.activatedAt).toBeDefined();

    const after = await ctx.repos.quests.getById(quest.id);
    expect(after.updatedAt).toEqual(before);
    expect(after.shelvedAt).toBeUndefined();
  });

  it("counts every quest in its progress, planned ones included", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "planned",
    });
    await createTestQuest(ctx.alepha, project, { epicId: epic.id });
    await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
      completedAt: ctx.dt.nowISOString(),
    });

    const [resource] = await ctx.controller.getEpics(
      { params: { projectId: project.id } },
      { user },
    );

    expect(resource.progress).toEqual({ completed: 1, total: 2 });
    expect(resource.questCount).toBe(2);
  });

  it("gets an epic by its per-project number", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      number: 1,
      title: "Deploy",
    });

    const resource = await ctx.controller.getEpicByNumber(
      { params: { projectId: project.id, number: 1 } },
      { user },
    );

    expect(resource.id).toBe(epic.id);
    expect(resource.title).toBe("Deploy");
  });

  it("updates title and description", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, { title: "Old" });

    const updated = await ctx.controller.updateEpic(
      { params: { id: epic.id }, body: { title: "New title" } },
      { user },
    );

    expect(updated.title).toBe("New title");
  });

  it("allows every status transition and manages the timestamps correctly", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "planned",
    });

    // planned -> active
    const activated = await ctx.controller.setEpicStatus(
      { params: { id: epic.id }, body: { status: "active" } },
      { user },
    );
    expect(activated.status).toBe("active");
    expect(activated.activatedAt).toBeDefined();
    const firstActivatedAt = activated.activatedAt;

    // active -> done
    const done = await ctx.controller.setEpicStatus(
      { params: { id: epic.id }, body: { status: "done" } },
      { user },
    );
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeDefined();

    // done -> active
    const reactivated = await ctx.controller.setEpicStatus(
      { params: { id: epic.id }, body: { status: "active" } },
      { user },
    );
    expect(reactivated.status).toBe("active");
    // The original activation timestamp survives a done -> active swing —
    // it marks when the epic began, not when it was last active.
    expect(reactivated.activatedAt).toEqual(firstActivatedAt);
    expect(reactivated.completedAt).toBeUndefined();

    // active -> planned
    const reparked = await ctx.controller.setEpicStatus(
      { params: { id: epic.id }, body: { status: "planned" } },
      { user },
    );
    expect(reparked.status).toBe("planned");
    expect(reparked.activatedAt).toEqual(firstActivatedAt);
    expect(reparked.completedAt).toBeUndefined();
  });

  it("orphans its quests and folios on delete instead of writing to them", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project);
    const quest = await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
    });
    const folio = await createTestFolio(ctx.alepha, project, {
      epicId: epic.id,
    });
    const questUpdatedAtBefore = (await ctx.repos.quests.getById(quest.id))
      .updatedAt;
    const folioUpdatedAtBefore = (await ctx.repos.folios.getById(folio.id))
      .updatedAt;

    await ctx.controller.deleteEpic({ params: { id: epic.id } }, { user });

    const survivingQuest = await ctx.repos.quests.getById(quest.id);
    const survivingFolio = await ctx.repos.folios.getById(folio.id);
    expect(survivingQuest.epicId).toBeUndefined();
    expect(survivingFolio.epicId).toBeUndefined();
    // The FK's `ON DELETE SET NULL` fires at the database level, not
    // through an application-level UPDATE — `updatedAt` (an app-maintained
    // column) proves no application code iterated and wrote these rows.
    expect(survivingQuest.updatedAt).toEqual(questUpdatedAtBefore);
    expect(survivingFolio.updatedAt).toEqual(folioUpdatedAtBefore);
  });

  it("attaches and detaches a quest, updating the progress rollup", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project);
    const quest = await createTestQuest(ctx.alepha, project);

    const attached = await ctx.controller.attachQuest(
      { params: { id: epic.id }, body: { questId: quest.id } },
      { user },
    );
    expect(attached.progress.total).toBe(1);
    expect((await ctx.repos.quests.getById(quest.id)).epicId).toBe(epic.id);

    const detached = await ctx.controller.detachQuest(
      { params: { id: epic.id, questId: quest.id } },
      { user },
    );
    expect(detached.progress.total).toBe(0);
    expect((await ctx.repos.quests.getById(quest.id)).epicId).toBeUndefined();
  });

  it("refuses to attach a quest from a different project", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const otherProject = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project);
    const foreignQuest = await createTestQuest(ctx.alepha, otherProject);

    await expect(
      ctx.controller.attachQuest(
        { params: { id: epic.id }, body: { questId: foreignQuest.id } },
        { user },
      ),
    ).rejects.toThrowError(BadRequestError);
  });

  it("attaches and detaches a folio", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project);
    const folio = await createTestFolio(ctx.alepha, project);

    await ctx.controller.attachFolio(
      { params: { id: epic.id }, body: { folioId: folio.id } },
      { user },
    );
    expect((await ctx.repos.folios.getById(folio.id)).epicId).toBe(epic.id);

    await ctx.controller.detachFolio(
      { params: { id: epic.id, folioId: folio.id } },
      { user },
    );
    expect((await ctx.repos.folios.getById(folio.id)).epicId).toBeUndefined();
  });

  it("refuses to attach a folio from a different project", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const otherProject = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project);
    const foreignFolio = await createTestFolio(ctx.alepha, otherProject);

    await expect(
      ctx.controller.attachFolio(
        { params: { id: epic.id }, body: { folioId: foreignFolio.id } },
        { user },
      ),
    ).rejects.toThrowError(BadRequestError);
  });

  it("refuses to mutate an epic for a non-owner", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const epic = await createTestEpic(ctx.alepha, project);
    const stranger = strangerToken();

    await expect(
      ctx.controller.updateEpic(
        { params: { id: epic.id }, body: { title: "Hijacked" } },
        { user: stranger },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("refuses to read a project's epics for a non-member", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const stranger = strangerToken();

    await expect(
      ctx.controller.getEpics(
        { params: { projectId: project.id } },
        { user: stranger },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });
});
