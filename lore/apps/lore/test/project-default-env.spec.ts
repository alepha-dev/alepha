import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * `projects.defaultEnv`: the write path, and the shape of the column.
 *
 * ⚠️ **It ships with its first reader, not before.** Epic #30 deliberately did
 * not add it - a column on the D1 cascade parent with no settings page to set
 * it is folio #1172's failure - and #1811's `lore apps` `--env` fallback is
 * that reader. The Apps settings page's row lands in the same commit.
 *
 * ⚠️ **Nullable, no `db.default`.** `projects` is the table whose rebuild
 * cascade-wiped production in 2026-05, and a column DEFAULT is what makes
 * drizzle generate one. The migration is the single statement
 * `ALTER TABLE projects ADD default_env text;` - read by eye, as the rule in
 * `apps/lore/CLAUDE.md` requires.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

describe("a project's default environment", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const world = async () => {
    const fake = ctx.fakeProvider.generate(userDataSchema);
    const created = await ctx.adminUserController.createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = (
      await ctx.projectController.createProject.fetch(
        { body: { title: `Env ${Math.random().toString(36).slice(2, 8)}` } },
        { user },
      )
    ).data;
    return { user, projectId: project.id };
  };

  const set = async (
    user: { id: string; roles: string[] },
    projectId: number,
    defaultEnv: string | null,
  ) =>
    (
      await ctx.projectController.updateProjectById.fetch(
        { params: { id: projectId }, body: { defaultEnv } },
        { user },
      )
    ).data;

  it("is unset on a new project, and that is not `production`", async ({
    expect,
  }) => {
    // The whole point of the column: `production` as a constant was wrong the
    // moment environments became rows. A project may run `b14-production` and
    // have no `production` at all.
    const { user, projectId } = await world();

    const project = (
      await ctx.projectController.getProjectById.fetch(
        { params: { id: projectId } },
        { user },
      )
    ).data;

    expect(project.defaultEnv).toBeUndefined();
  });

  it("round-trips a value onto the resource the CLI reads", async ({
    expect,
  }) => {
    // ⚠️ Read back through `getProjectBySlug`, which is the exact call
    // `LoreProjectResolver.resolveEnv` makes. A field on the entity that never
    // reached the response schema would fail silently there and nowhere else.
    const { user, projectId } = await world();
    const saved = await set(user, projectId, "b14-production");
    expect(saved.defaultEnv).toBe("b14-production");

    const read = (
      await ctx.projectController.getProjectBySlug.fetch(
        { params: { slug: saved.slug } },
        { user },
      )
    ).data;

    expect(read.defaultEnv).toBe("b14-production");
  });

  it("normalises the way an instance's own env is normalised", async ({
    expect,
  }) => {
    // `AppService` lowercases and trims an env on the way in, so a default
    // stored differently could never match a row.
    const { user, projectId } = await world();

    expect((await set(user, projectId, "  B14-Production ")).defaultEnv).toBe(
      "b14-production",
    );
  });

  it("clears on null, and on an empty string from a cleared field", async ({
    expect,
  }) => {
    const { user, projectId } = await world();
    await set(user, projectId, "staging");

    expect((await set(user, projectId, null)).defaultEnv).toBeUndefined();

    await set(user, projectId, "staging");
    expect((await set(user, projectId, "  ")).defaultEnv).toBeUndefined();
  });

  it("refuses a name an environment could never have", async ({ expect }) => {
    // Not validated against the project's INSTANCES on purpose - an operator
    // may name the env they are about to create - but a value that no env
    // could ever be named is a typo worth refusing rather than storing.
    const { user, projectId } = await world();

    await expect(set(user, projectId, "Prod/Uction")).rejects.toThrowError(
      /not a valid environment name/,
    );
  });
});
