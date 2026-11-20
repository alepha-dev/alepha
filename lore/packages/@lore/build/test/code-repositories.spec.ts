import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ProjectController,
  ProjectDeletionService,
  ProjectLimits,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  CodeRepositoryController,
  CodeRepositoryService,
  LocalGitBackend,
  LoreBuildApi,
} from "../src/api/index.ts";
import { createTestMemberByProjectId } from "../src/testing/index.ts";

/**
 * A project's git repositories (#E162, #Q3928), against `LocalGitBackend` in
 * a temporary `DATA_DIR`: the real `git` binary, real bare repositories.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

interface TestContext {
  alepha: Alepha;
  dataDir: string;
  repos: CodeRepositoryController;
  service: CodeRepositoryService;
  backend: LocalGitBackend;
}

const setup = async (): Promise<TestContext> => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-code-"));
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATA_DIR: dataDir,
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreBuildApi);
  await alepha.start();
  return {
    alepha,
    dataDir,
    repos: alepha.inject(CodeRepositoryController),
    service: alepha.inject(CodeRepositoryService),
    backend: alepha.inject(LocalGitBackend),
  };
};

describe("code repositories", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
    await rm(ctx.dataDir, { recursive: true, force: true });
  });

  const aUser = async () => {
    const fake = ctx.alepha.inject(FakeProvider).generate(userDataSchema);
    const response = await ctx.alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    return { id: response.data.id, roles: response.data.roles };
  };

  const aProject = async (
    build = true,
    options = { repositories: true, quality: true },
  ) => {
    const owner = await aUser();
    const project = await ctx.alepha
      .inject(ProjectController)
      .createProject.fetch(
        {
          body: {
            title: `Code ${crypto.randomUUID().slice(0, 8)}`,
            capabilities: build ? [{ key: "build" as const, options }] : [],
          },
        },
        { user: owner },
      );
    return { owner, projectId: project.data.id, slug: project.data.slug };
  };

  const create = (projectId: number, user: { id: string }, slug: string) =>
    ctx.repos.createCodeRepository.fetch(
      { params: { projectId }, body: { slug } },
      { user },
    );

  it("creates a bare repository on disk, named by id, and lists it", async ({
    expect,
  }) => {
    const { owner, projectId, slug } = await aProject();

    const created = (await create(projectId, owner, "api")).data;

    const row = await ctx.service.find(projectId, "api");
    expect(row?.backendRef).toBe(`${projectId}/${created.id}`);
    const path = ctx.backend.pathOf(row!.backendRef);
    expect(path.startsWith(join(ctx.dataDir, "git"))).toBe(true);
    expect(existsSync(join(path, "HEAD"))).toBe(true);
    expect((await ctx.backend.info(row!.backendRef))?.defaultBranch).toBe(
      "main",
    );
    expect(created.cloneUrl).toMatch(new RegExp(`/${slug}/api\\.git$`));

    const listed = await ctx.repos.listCodeRepositories.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(listed.data.repositories.map((it) => it.slug)).toEqual(["api"]);
  });

  it("gives the repository named like its project the short clone URL", async ({
    expect,
  }) => {
    const { owner, projectId, slug } = await aProject();

    const created = (await create(projectId, owner, slug!)).data;

    expect(created.cloneUrl).toMatch(new RegExp(`/${slug}\\.git$`));
  });

  it("refuses a slug outside [a-z0-9-], and a second one by the same name", async ({
    expect,
  }) => {
    const { owner, projectId } = await aProject();

    await expect(create(projectId, owner, "My.Repo")).rejects.toThrow(
      /Lowercase letters, digits and hyphens/,
    );
    await create(projectId, owner, "api");
    await expect(create(projectId, owner, "api")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses a create without the build capability, with 400", async ({
    expect,
  }) => {
    const { owner, projectId } = await aProject(false);

    await expect(create(projectId, owner, "api")).rejects.toMatchObject({
      status: 400,
    });
    expect(await ctx.backend.list()).toEqual([]);
  });

  it("refuses a create with Build on but Repositories off, naming the option (#Q4005)", async ({
    expect,
  }) => {
    const { owner, projectId } = await aProject(true, {
      repositories: false,
      quality: true,
    });

    await expect(create(projectId, owner, "api")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("build.repositories"),
    });
    expect(await ctx.backend.list()).toEqual([]);
  });

  it("lets a Member list but not create or delete: code:admin is an Admin's", async ({
    expect,
  }) => {
    const { owner, projectId } = await aProject();
    await createPresetRanks(ctx.alepha, projectId);
    await create(projectId, owner, "api");
    const member = await aUser();
    await createTestMemberByProjectId(ctx.alepha, projectId, member.id, {
      rank: "member",
    });

    const listed = await ctx.repos.listCodeRepositories.fetch(
      { params: { projectId } },
      { user: member },
    );
    expect(listed.data.repositories).toHaveLength(1);
    await expect(create(projectId, member, "web")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      ctx.repos.deleteCodeRepository.fetch(
        { params: { projectId, slug: "api" } },
        { user: member },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("deletes the repository on disk and its row", async ({ expect }) => {
    const { owner, projectId } = await aProject();
    await create(projectId, owner, "api");
    const path = ctx.backend.pathOf(
      (await ctx.service.find(projectId, "api"))!.backendRef,
    );

    await ctx.repos.deleteCodeRepository.fetch(
      { params: { projectId, slug: "api" } },
      { user: owner },
    );

    expect(existsSync(path)).toBe(false);
    expect(await ctx.service.find(projectId, "api")).toBeUndefined();
  });

  it("deletes every repository with its project, explicitly", async ({
    expect,
  }) => {
    const { owner, projectId } = await aProject();
    await create(projectId, owner, "api");
    await create(projectId, owner, "web");
    expect(await ctx.backend.list()).toHaveLength(2);

    await ctx.alepha.inject(ProjectDeletionService).deleteProject(projectId);

    expect(await ctx.backend.list()).toEqual([]);
    expect(await ctx.service.list(projectId)).toEqual([]);
  });

  it("stops at the project's repository count", async ({ expect }) => {
    const { owner, projectId } = await aProject();
    const limits = ctx.alepha.inject(ProjectLimits);
    await limits.limits.set({
      ...(await limits.limits.get()),
      maxRepositoriesPerProject: 1,
    });
    await create(projectId, owner, "api");

    await expect(create(projectId, owner, "web")).rejects.toMatchObject({
      status: 400,
    });
  });
});
