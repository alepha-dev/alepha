import { ProjectArchiveGuard, ProjectController } from "@lore/core/api";
import { ProjectTools } from "@lore/core/mcp";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import {
  AlephaSecurity,
  currentUserAtom,
  type UserAccountToken,
} from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import { CoreTestEntities } from "../src/testing/index.ts";

interface Ctx {
  alepha: Alepha;
  repos: CoreTestEntities;
  projects: ProjectController;
  tools: ProjectTools;
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreCoreApi);

  const repos = alepha.inject(CoreTestEntities);
  // Before start: a service injected after it is refused.
  const tools = alepha.inject(ProjectTools);

  await alepha.start();

  return {
    alepha,
    repos,
    projects: alepha.inject(ProjectController),
    tools,
  };
};

/**
 * Archiving a project (#Q2601): owner only, nothing deleted, and the overview
 * keeps listing it so My projects can show the badge.
 */
describe("archiveProject / unarchiveProject", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const ownedProject = async () => {
    const owner = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: owner.id, roles: ["user"] };
    const created = await ctx.projects.createProject(
      { body: { title: "Minorca" } },
      { user },
    );
    await createPresetRanks(ctx.alepha, created.id);
    return { user, created };
  };

  it("archives and unarchives, and the overview still lists the project", async ({
    expect,
  }) => {
    const { user, created } = await ownedProject();
    ctx.alepha.inject(DateTimeProvider).pause();
    const now = ctx.alepha.inject(DateTimeProvider).nowISOString();

    const archived = await ctx.projects.archiveProject(
      { params: { id: created.id } },
      { user },
    );
    expect(archived.archivedAt).toBe(now);

    const overview = await ctx.projects.getHomeOverview({}, { user });
    expect(overview.projects.map((it) => it.archivedAt)).toEqual([now]);

    const restored = await ctx.projects.unarchiveProject(
      { params: { id: created.id } },
      { user },
    );
    expect(restored.archivedAt).toBeUndefined();
    expect(
      (await ctx.repos.projects.findById(created.id))?.archivedAt,
    ).toBeUndefined();
  });

  it("keeps the first archive date when archived twice", async ({ expect }) => {
    const { user, created } = await ownedProject();
    const first = await ctx.projects.archiveProject(
      { params: { id: created.id } },
      { user },
    );
    await ctx.alepha.inject(DateTimeProvider).travel(60_000);

    const second = await ctx.projects.archiveProject(
      { params: { id: created.id } },
      { user },
    );
    expect(second.archivedAt).toBe(first.archivedAt);
  });

  it("refuses an admin who is not the owner", async ({ expect }) => {
    const { created } = await ownedProject();
    const other = await ctx.repos.users.create({});
    await ctx.repos.members.create({
      organizationId: (await ctx.repos.projects.findById(created.id))!
        .organizationId!,
      userId: other.id,
      rank: "admin",
    });

    await expect(
      ctx.projects.archiveProject(
        { params: { id: created.id } },
        { user: { id: other.id, roles: ["user"] } },
      ),
    ).rejects.toThrow();
    expect(
      (await ctx.repos.projects.findById(created.id))?.archivedAt,
    ).toBeUndefined();
  });

  it("is read-only while archived: a write is refused, a read answers, unarchiving restores (#Q4051)", async ({
    expect,
  }) => {
    const { user, created } = await ownedProject();
    await ctx.projects.archiveProject({ params: { id: created.id } }, { user });

    await expect(
      ctx.projects.updateProjectById(
        { params: { id: created.id }, body: { title: "Renamed" } },
        { user },
      ),
    ).rejects.toThrow("archived and read-only");
    expect((await ctx.repos.projects.findById(created.id))?.title).toBe(
      "Minorca",
    );
    const read = await ctx.projects.getProjectById(
      { params: { id: created.id } },
      { user },
    );
    expect(read.title).toBe("Minorca");

    await ctx.projects.unarchiveProject(
      { params: { id: created.id } },
      { user },
    );
    const renamed = await ctx.projects.updateProjectById(
      { params: { id: created.id }, body: { title: "Renamed" } },
      { user },
    );
    expect(renamed.title).toBe("Renamed");
  });

  it("refuses an MCP write tool on an archived project, and lets a read tool through (#Q4051)", async ({
    expect,
  }) => {
    const { user, created } = await ownedProject();
    await ctx.projects.archiveProject({ params: { id: created.id } }, { user });
    const guard = ctx.alepha.inject(ProjectArchiveGuard);
    const tools = ctx.tools;

    await ctx.alepha.context.run(async () => {
      ctx.alepha.store.set(currentUserAtom, user);
      // A read tool goes through.
      ctx.alepha.context.set(ProjectArchiveGuard.WRITE_KEY, false);
      expect(await tools.resolveProjectId(created.id)).toBe(created.id);
      // A write tool does not.
      ctx.alepha.context.set(ProjectArchiveGuard.WRITE_KEY, true);
      expect(guard.mcpWrite()).toBe(true);
      await expect(tools.resolveProjectId(created.id)).rejects.toThrow(
        "archived and read-only",
      );
    });
  });

  it("tells a write from a read by method and required permissions (#Q4051)", ({
    expect,
  }) => {
    const guard = ctx.alepha.inject(ProjectArchiveGuard);
    expect(guard.refusesWrite("GET", "quest:create")).toBe(false);
    expect(guard.refusesWrite("POST", "quest:create")).toBe(true);
    expect(guard.refusesWrite("POST", ["quest:read", "folio:read"])).toBe(
      false,
    );
    expect(guard.refusesWrite("PATCH", undefined)).toBe(true);
    expect(guard.refusesWrite(undefined, "quest:create")).toBe(false);
  });
});
