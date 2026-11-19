import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { CodeRepositoryController, LoreBuildApi } from "../src/api/index.ts";
import { createTestMemberByProjectId } from "../src/testing/index.ts";

/**
 * git smart HTTP on `.git` URLs (#Q3932), driven by the real `git` against
 * the spec's own server and `LocalGitBackend` in a temporary `DATA_DIR`:
 * auth, the capability gate, a push and a clone, the default branch's
 * protection.
 */
const run = promisify(execFile);
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

interface TestContext {
  alepha: Alepha;
  dataDir: string;
  work: string;
  baseUrl: string;
}

const setup = async (): Promise<TestContext> => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-git-data-"));
  const work = await mkdtemp(join(tmpdir(), "lore-git-work-"));
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
    work,
    baseUrl: alepha.inject(NodeHttpServerProvider).hostname,
  };
};

describe("git smart HTTP", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
    await rm(ctx.dataDir, { recursive: true, force: true });
    await rm(ctx.work, { recursive: true, force: true });
  });

  const aUser = async () => {
    const fake = ctx.alepha.inject(FakeProvider).generate(userDataSchema);
    const response = await ctx.alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    const user = { id: response.data.id, roles: response.data.roles };
    const key = await ctx.alepha
      .inject(ApiKeyController)
      .createApiKey.fetch({ body: { name: "git" } }, { user });
    return { ...user, key: key.data.token };
  };

  const aProject = async (options: { build?: boolean; repo?: string } = {}) => {
    const owner = await aUser();
    const project = await ctx.alepha
      .inject(ProjectController)
      .createProject.fetch(
        {
          body: {
            title: `Git ${crypto.randomUUID().slice(0, 8)}`,
            capabilities: [{ key: "build" as const }],
          },
        },
        { user: owner },
      );
    const projectId = project.data.id;
    const slug = project.data.slug!;
    const repo = await ctx.alepha
      .inject(CodeRepositoryController)
      .createCodeRepository.fetch(
        { params: { projectId }, body: { slug: options.repo ?? "api" } },
        { user: owner },
      );
    if (options.build === false) {
      await ctx.alepha
        .inject(ProjectCapabilityController)
        .setCapability.fetch(
          { params: { projectId, key: "build" }, body: { enabled: false } },
          { user: owner },
        );
    }
    return { owner, projectId, slug, cloneUrl: repo.data.cloneUrl };
  };

  /**
   * `git`, isolated from the machine: no global config, no credential
   * helper, never a prompt.
   */
  const git = (args: string[], cwd = ctx.work) =>
    run(
      "git",
      ["-c", "credential.helper=", "-c", "protocol.version=2", ...args],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: ctx.work,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_AUTHOR_NAME: "lore",
          GIT_AUTHOR_EMAIL: "lore@example.com",
          GIT_COMMITTER_NAME: "lore",
          GIT_COMMITTER_EMAIL: "lore@example.com",
        },
      },
    );

  const withKey = (url: string, key: string) => {
    const parsed = new URL(url);
    parsed.username = "x";
    parsed.password = key;
    return parsed.toString();
  };

  const aCheckout = async (name = "source") => {
    const dir = join(ctx.work, name);
    await git(["init", "--quiet", "-b", "main", dir]);
    await writeFile(join(dir, "README.md"), `${name}\n`);
    await git(["add", "README.md"], dir);
    await git(["commit", "--quiet", "-m", "first"], dir);
    return dir;
  };

  it("answers 401 with a Basic challenge before any lookup", async ({
    expect,
  }) => {
    for (const path of [
      "/nobody/nothing.git/info/refs?service=git-upload-pack",
      "/nothing.git/info/refs?service=git-upload-pack",
    ]) {
      const response = await fetch(`${ctx.baseUrl}${path}`);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Basic/);
    }
  });

  it("answers 404 on a URL that is not a .git one, or the dumb protocol", async ({
    expect,
  }) => {
    const { owner, slug } = await aProject();
    const auth = `Basic ${btoa(`x:${owner.key}`)}`;
    const notGit = await fetch(
      `${ctx.baseUrl}/${slug}/api/info/refs?service=git-upload-pack`,
      { headers: { authorization: auth } },
    );
    const dumb = await fetch(`${ctx.baseUrl}/${slug}/api.git/info/refs`, {
      headers: { authorization: auth },
    });
    expect(notGit.status).toBe(404);
    expect(dumb.status).toBe(404);
  });

  it("takes a push and serves the clone, with an API key as the password", async ({
    expect,
  }) => {
    const { owner, cloneUrl } = await aProject();
    const source = await aCheckout();
    const { stdout: head } = await git(["rev-parse", "HEAD"], source);

    await git(
      ["push", "--quiet", withKey(cloneUrl, owner.key), "main"],
      source,
    );
    await git(["clone", "--quiet", withKey(cloneUrl, owner.key), "clone"]);

    const { stdout: cloned } = await git(
      ["rev-parse", "HEAD"],
      join(ctx.work, "clone"),
    );
    expect(cloned.trim()).toBe(head.trim());
  });

  it("serves the repository named like its project on /<project>.git", async ({
    expect,
  }) => {
    const project = await aProject();
    const own = await ctx.alepha
      .inject(CodeRepositoryController)
      .createCodeRepository.fetch(
        {
          params: { projectId: project.projectId },
          body: { slug: project.slug },
        },
        { user: project.owner },
      );
    const url = `${ctx.baseUrl}/${project.slug}.git`;
    expect(own.data.cloneUrl.endsWith(`/${project.slug}.git`)).toBe(true);
    const source = await aCheckout();

    await git(
      ["push", "--quiet", withKey(url, project.owner.key), "main"],
      source,
    );
    await git(["clone", "--quiet", withKey(url, project.owner.key), "short"]);

    const { stdout } = await git(["log", "--oneline"], join(ctx.work, "short"));
    expect(stdout).toMatch(/first/);
  });

  it("inflates a gzipped request body before git reads it", async ({
    expect,
  }) => {
    const { owner, cloneUrl } = await aProject();
    const source = await aCheckout();
    await git(
      ["push", "--quiet", withKey(cloneUrl, owner.key), "main"],
      source,
    );
    // A protocol v2 `ls-refs`, gzipped as git gzips a large request.
    const pkt = (line: string) =>
      `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
    const request = `${pkt("command=ls-refs\n")}0001${pkt("ref-prefix refs/heads/\n")}0000`;
    const gzipped = await new Response(
      new Blob([request]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();

    const response = await fetch(`${cloneUrl}/git-upload-pack`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`x:${owner.key}`)}`,
        "content-type": "application/x-git-upload-pack-request",
        "content-encoding": "gzip",
        "git-protocol": "version=2",
      },
      body: gzipped,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/refs\/heads\/main/);
  });

  it("refuses to delete the default branch, saying why", async ({ expect }) => {
    const { owner, cloneUrl } = await aProject();
    const source = await aCheckout();
    const remote = withKey(cloneUrl, owner.key);
    await git(["push", "--quiet", remote, "main"], source);

    const refused = await git(["push", remote, ":main"], source).catch(
      (error) => error as { stderr: string },
    );

    expect(String((refused as { stderr: string }).stderr)).toMatch(
      /default branch main cannot be deleted/,
    );
    await git(["push", "--quiet", remote, "main:other"], source);
    await git(["push", "--quiet", remote, ":other"], source);
  });

  it("lets a Viewer clone and refuses its push with 403", async ({
    expect,
  }) => {
    const { owner, projectId, cloneUrl } = await aProject();
    await createPresetRanks(ctx.alepha, projectId);
    const viewer = await aUser();
    await createTestMemberByProjectId(ctx.alepha, projectId, viewer.id, {
      rank: "viewer",
    });
    const source = await aCheckout();
    await git(
      ["push", "--quiet", withKey(cloneUrl, owner.key), "main"],
      source,
    );

    await git(["clone", "--quiet", withKey(cloneUrl, viewer.key), "viewer"]);
    const refused = await git(
      ["push", withKey(cloneUrl, viewer.key), "main:feature"],
      source,
    ).catch((error) => error as { stderr: string });

    expect(String((refused as { stderr: string }).stderr)).toMatch(/403/);
  });

  it("hides a repository from a stranger behind a 404", async ({ expect }) => {
    const { slug } = await aProject();
    const stranger = await aUser();
    const response = await fetch(
      `${ctx.baseUrl}/${slug}/api.git/info/refs?service=git-upload-pack`,
      { headers: { authorization: `Basic ${btoa(`x:${stranger.key}`)}` } },
    );
    expect(response.status).toBe(404);
  });

  it("answers 404 on a read and 400 on a write without Build", async ({
    expect,
  }) => {
    const { owner, slug } = await aProject({ build: false });
    const auth = { authorization: `Basic ${btoa(`x:${owner.key}`)}` };
    const read = await fetch(
      `${ctx.baseUrl}/${slug}/api.git/info/refs?service=git-upload-pack`,
      { headers: auth },
    );
    const write = await fetch(
      `${ctx.baseUrl}/${slug}/api.git/info/refs?service=git-receive-pack`,
      { headers: auth },
    );
    expect(read.status).toBe(404);
    expect(write.status).toBe(400);
  });
});
