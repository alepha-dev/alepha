import { AlephaLoreCli, loreOptions } from "@alepha/lore/cli";
import { Alepha, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { CliProvider } from "alepha/command";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * `alepha lore releases publish` against the real Lore app, over HTTP, with a
 * real API key.
 *
 * `ReleaseCommand.spec.ts` in `@alepha/lore` covers the command's three
 * outcomes against a fake client. What it cannot cover is the question the
 * quest left open: `publishRelease` is gated by `$secure({ permissions:
 * ["quest:create"] })` AND `$ownsProject({ owner: true })`, and neither
 * `quality push` nor `artifacts push` exercises a named permission or the
 * owner gate. An API key resolves to `{ id: apiKey.userId, roles }`, and the
 * default `user` role grants `*` with ownership, so it SHOULD clear both. This
 * is the one real call that proves it, plus the refusal that proves the gate
 * is real rather than absent.
 *
 * ⚠️ Two containers, and it has to be two: the CLI's `$env` resolves
 * `LORE_URL` when its container boots, and the server's port is only known
 * after the server's container has started. Same arrangement as
 * `ArtifactUploader.spec.ts`, and the same one the real thing has.
 */
const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

type TestUser = { id: string; roles: string[] };

interface TestContext {
  alepha: Alepha;
  hostname: string;
  adminUserController: AdminUserController;
  apiKeyController: ApiKeyController;
  projectController: ProjectController;
  releaseController: ReleaseController;
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
    hostname: alepha.inject(NodeHttpServerProvider).hostname,
    adminUserController: alepha.inject(AdminUserController),
    apiKeyController: alepha.inject(ApiKeyController),
    projectController: alepha.inject(ProjectController),
    releaseController: alepha.inject(ReleaseController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext): Promise<TestUser> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createApiKey = async (
  ctx: TestContext,
  user: TestUser,
): Promise<string> => {
  const response = await ctx.apiKeyController.createApiKey.fetch(
    { body: { name: "release job" } },
    { user },
  );
  return response.data.token;
};

/**
 * Direct row insert, bypassing the invitation flow: a member who is not the
 * owner, which is the one shape that separates the owner gate from the
 * membership gate.
 */
const addMember = async (
  ctx: TestContext,
  userId: string,
  projectId: number,
): Promise<void> => {
  const members = (ctx.projectController as any).members;
  await members.create({ userId, projectId, owner: false });
};

/**
 * The CLI's own container, pointed at the server's, holding the key the way
 * a CI job holds `LORE_API_KEY`. Never started: `CliProvider`'s start hook
 * would read vitest's argv and print the root help, and `run()` needs no
 * lifecycle.
 */
const cliFor = async (ctx: TestContext, token: string, project: string) => {
  const cli = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      LORE_API_KEY: token,
      LORE_URL: ctx.hostname,
    },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with(AlephaLoreCli);

  cli.set(loreOptions, { project });

  const publish = cli
    .primitives<any>("$command")
    .find((command) => command.name === "publish");

  return {
    cli,
    publish: (tag: string) =>
      cli.inject(CliProvider).run(publish, { argv: `--tag ${tag}` }),
  };
};

describe("alepha lore releases publish, against Lore", () => {
  let ctx: TestContext;
  const clis: Alepha[] = [];

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    for (const cli of clis.splice(0)) {
      await cli.stop();
    }
    await ctx.alepha.stop();
  });

  it("publishes with the owner's API key, through quest:create and the owner gate", async () => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Release CLI" } },
      { user: owner },
    );
    await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.data.id }, body: { tag: "0.28.0" } },
      { user: owner },
    );

    const job = await cliFor(
      ctx,
      await createApiKey(ctx, owner),
      project.data.slug,
    );
    clis.push(job.cli);

    await job.publish("0.28.0");

    const releases = await ctx.releaseController.getReleases.fetch(
      { params: { projectId: project.data.id } },
      { user: owner },
    );
    const published = releases.data.find((it) => it.tag === "0.28.0");
    expect(published?.releasedAt).toBeTruthy();
    // Frozen at publish: the changelog is a snapshot from here on.
    expect(published?.changelog).toBeTruthy();

    // The re-run of the same job, which must be a no-op rather than an error.
    await expect(job.publish("0.28.0")).resolves.not.toThrow();
    const again = await ctx.releaseController.getReleases.fetch(
      { params: { projectId: project.data.id } },
      { user: owner },
    );
    expect(again.data.find((it) => it.tag === "0.28.0")?.releasedAt).toBe(
      published?.releasedAt,
    );
  });

  /**
   * The gate is real: a member's key lists the releases (member-level read)
   * and is then refused the publish (owner-level write). The command lets
   * that refusal through as a failure, because a key that cannot publish is a
   * configuration fact the job must not paper over.
   */
  it("refuses a member's API key at the owner gate, and the job fails", async () => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Release CLI" } },
      { user: owner },
    );
    await addMember(ctx, member.id, project.data.id);
    await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.data.id }, body: { tag: "0.28.0" } },
      { user: owner },
    );

    const job = await cliFor(
      ctx,
      await createApiKey(ctx, member),
      project.data.slug,
    );
    clis.push(job.cli);

    await expect(job.publish("0.28.0")).rejects.toThrow();

    const releases = await ctx.releaseController.getReleases.fetch(
      { params: { projectId: project.data.id } },
      { user: owner },
    );
    expect(
      releases.data.find((it) => it.tag === "0.28.0")?.releasedAt,
    ).toBeFalsy();
  });

  it("exits cleanly when the project has no release with that tag", async () => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Release CLI" } },
      { user: owner },
    );

    const job = await cliFor(
      ctx,
      await createApiKey(ctx, owner),
      project.data.slug,
    );
    clis.push(job.cli);

    await expect(job.publish("0.28.0")).resolves.not.toThrow();
  });
});
