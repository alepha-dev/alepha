import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, BadRequestError, ForbiddenError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { LoreApi } from "../index.ts";
import { AreaService } from "../services/AreaService.ts";
import { AreaController } from "./AreaController.ts";

interface TestContext {
  alepha: Alepha;
  controller: AreaController;
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

  // Registered before `start()` — the exact instance later `inject()` calls
  // must hit, so the FK closure `AreaController`'s fixtures reach (projects,
  // users, quests, ...) is known to the schema sync before boot. See the
  // comment on `TestEntityRepositories`.
  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(AreaController),
    service: alepha.inject(AreaService),
    repos,
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

describe("AreaController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists a project's areas with open and total counts", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    await ctx.service.ensureArea(project.id, "alepha/orm");
    await createTestQuest(ctx.alepha, project, {
      area: "alepha/orm",
    });

    const result = await ctx.controller.getAreas(
      { params: { projectId: project.id } },
      { user },
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("alepha/orm");
    expect(result[0].openQuestCount).toBe(1);
  });

  it("refuses to list areas of a project you are not a member of", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.getAreas(
        { params: { projectId: project.id } },
        { user: strangerToken() },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("refuses to get an area's detail for a non-member", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const area = await ctx.service.ensureArea(project.id, "alepha/orm");

    await expect(
      ctx.controller.getArea(
        { params: { id: area!.id } },
        { user: strangerToken() },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("saves a description", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const area = await ctx.service.ensureArea(project.id, "alepha/orm");

    const updated = await ctx.controller.updateArea(
      {
        params: { id: area!.id },
        body: { description: "Entities, repositories, queries, migrations." },
      },
      { user },
    );

    expect(updated.description).toBe(
      "Entities, repositories, queries, migrations.",
    );
  });

  it("refuses a description write from a non-owner", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const area = await ctx.service.ensureArea(project.id, "alepha/orm");

    await expect(
      ctx.controller.updateArea(
        { params: { id: area!.id }, body: { description: "nope" } },
        { user: strangerToken() },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("reports a plain rename as not merged", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const area = await ctx.service.ensureArea(project.id, "ui");

    const result = await ctx.controller.renameArea(
      { params: { id: area!.id }, body: { name: "@alepha/ui" } },
      { user },
    );

    expect(result.merged).toBe(false);
    // Without a merge, the surviving area IS the one addressed in the
    // path — the detail page must navigate right back to itself.
    expect(result.areaId).toBe(area!.id);
  });

  it("refuses a rename from a non-owner", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const area = await ctx.service.ensureArea(project.id, "ui");

    await expect(
      ctx.controller.renameArea(
        { params: { id: area!.id }, body: { name: "@alepha/ui" } },
        { user: strangerToken() },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("reports a rename onto an existing name as a merge, with the count", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const source = await ctx.service.ensureArea(project.id, "folio");
    const target = await ctx.service.ensureArea(project.id, "Folio");
    await createTestQuest(ctx.alepha, project, {
      area: "folio",
    });

    const result = await ctx.controller.renameArea(
      { params: { id: source!.id }, body: { name: "Folio" } },
      { user },
    );

    expect(result.merged).toBe(true);
    expect(result.movedQuests).toBe(1);
    // After a merge the survivor is the TARGET, not the area addressed
    // in the path — the detail page navigates to `result.areaId`, and a
    // regression here would land it on a deleted row.
    expect(result.areaId).toBe(target!.id);
  });

  it("deletes an area that holds no quest", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const area = await ctx.service.ensureArea(project.id, "deck");

    await ctx.controller.deleteArea({ params: { id: area!.id } }, { user });

    expect(await ctx.service.listWithStats(project.id)).toHaveLength(0);
  });

  it("refuses to delete an area that still holds quests", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const area = await ctx.service.ensureArea(project.id, "alepha/orm");
    await createTestQuest(ctx.alepha, project, {
      area: "alepha/orm",
    });

    await expect(
      ctx.controller.deleteArea({ params: { id: area!.id } }, { user }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("refuses to delete an area for a non-owner", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const area = await ctx.service.ensureArea(project.id, "deck");

    await expect(
      ctx.controller.deleteArea(
        { params: { id: area!.id } },
        { user: strangerToken() },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("refuses to bulk-merge areas for a non-owner", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const a = await ctx.service.ensureArea(project.id, "cli");
    const target = await ctx.service.ensureArea(project.id, "alepha/cli");

    await expect(
      ctx.controller.mergeAreas(
        {
          params: { projectId: project.id },
          body: { sourceIds: [a!.id], targetId: target!.id },
        },
        { user: strangerToken() },
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("bulk-merges several areas into one", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const a = await ctx.service.ensureArea(project.id, "cli");
    const b = await ctx.service.ensureArea(project.id, "CLI");
    const target = await ctx.service.ensureArea(project.id, "alepha/cli");
    await createTestQuest(ctx.alepha, project, { area: "cli" });
    await createTestQuest(ctx.alepha, project, { area: "CLI" });

    const result = await ctx.controller.mergeAreas(
      {
        params: { projectId: project.id },
        body: { sourceIds: [a!.id, b!.id], targetId: target!.id },
      },
      { user },
    );

    expect(result.movedQuests).toBe(2);
    expect(await ctx.service.listWithStats(project.id)).toHaveLength(1);
  });
});
