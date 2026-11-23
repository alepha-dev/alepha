import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  CommitReferenceRegistry,
  type CommitReferenceInput,
  JobKeyService,
  ProjectCapabilityController,
  ProjectController,
} from "@lore/core/api";
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

import {
  CodeCommitIndex,
  CodeRepositoryController,
  GitReceivePack,
  LoreBuildApi,
} from "../src/api/index.ts";
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

  const aProject = async (
    options: { build?: boolean; repositories?: boolean; repo?: string } = {},
  ) => {
    const owner = await aUser();
    const project = await ctx.alepha
      .inject(ProjectController)
      .createProject.fetch(
        {
          body: {
            title: `Git ${crypto.randomUUID().slice(0, 8)}`,
            capabilities: [
              {
                key: "build" as const,
                options: { repositories: true, quality: true },
              },
            ],
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
    if (options.repositories === false) {
      await ctx.alepha.inject(ProjectCapabilityController).setCapability.fetch(
        {
          params: { projectId, key: "build" },
          body: {
            enabled: true,
            options: { repositories: false, quality: true },
          },
        },
        { user: owner },
      );
    }
    if (options.build === false) {
      await ctx.alepha
        .inject(ProjectCapabilityController)
        .setCapability.fetch(
          { params: { projectId, key: "build" }, body: { enabled: false } },
          { user: owner },
        );
    }
    return {
      owner,
      projectId,
      slug,
      cloneUrl: repo.data.cloneUrl,
      repositoryId: repo.data.id,
    };
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

  it("offers push-options and takes an import's push option, keeping it from the backend", async ({
    expect,
  }) => {
    const { owner, cloneUrl } = await aProject();
    const advertisement = await fetch(
      `${cloneUrl}/info/refs?service=git-receive-pack`,
      { headers: { authorization: `Basic ${btoa(`x:${owner.key}`)}` } },
    );
    expect(await advertisement.text()).toMatch(/push-options/);
    const source = await aCheckout();

    await git(
      [
        "push",
        "--quiet",
        "--push-option=lore-import",
        withKey(cloneUrl, owner.key),
        "main",
      ],
      source,
    );
    await git(["clone", "--quiet", withKey(cloneUrl, owner.key), "imported"]);

    const { stdout } = await git(
      ["log", "--oneline"],
      join(ctx.work, "imported"),
    );
    expect(stdout).toMatch(/first/);
  });

  describe("after a push (#Q3945)", () => {
    const recorded: CommitReferenceInput[] = [];
    const listen = () => {
      recorded.length = 0;
      ctx.alepha.inject(CommitReferenceRegistry).register(async (input) => {
        recorded.push(input);
        return { quests: [], commits: input.commits.length };
      });
    };
    const pushes = async (projectId: number, user: { id: string }) => {
      const page = await ctx.alepha
        .inject(ProjectController)
        .getProjectActivity.fetch(
          { params: { id: projectId }, query: { size: 50 } },
          { user: user as never },
        );
      return page.data.content.filter((row) => row.type === "code");
    };
    const commit = async (dir: string, message: string) => {
      await writeFile(join(dir, `${crypto.randomUUID()}.txt`), message);
      await git(["add", "."], dir);
      await git(["commit", "--quiet", "-m", message], dir);
    };

    it("hands the pushed commits to the recorder, by the pusher, and writes a code:push row", async ({
      expect,
    }) => {
      listen();
      const { owner, projectId, slug, cloneUrl } = await aProject();
      const source = await aCheckout();
      const remote = withKey(cloneUrl, owner.key);
      await git(["push", "--quiet", remote, "main"], source);
      expect(recorded.at(-1)?.commits ?? []).toEqual([]);

      await commit(source, "feat: one #Q12");
      await commit(source, "fix: two #Q12 #Q13\n\nbody");
      await git(["push", "--quiet", remote, "main"], source);

      const last = recorded.at(-1)!;
      expect(last.projectId).toBe(projectId);
      expect(last.userId).toBe(owner.id);
      expect(last.repo).toBe(`${slug}/api`);
      expect(last.commits.map((it) => it.message)).toEqual([
        "fix: two #Q12 #Q13\n\nbody",
        "feat: one #Q12",
      ]);
      const rows = await pushes(projectId, owner);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toMatchObject({ action: "push", resourceId: "api" });
    });

    it("records no commit for an import, nor for a branch's creation", async ({
      expect,
    }) => {
      listen();
      const { owner, cloneUrl } = await aProject();
      const source = await aCheckout();
      const remote = withKey(cloneUrl, owner.key);
      await git(["push", "--quiet", remote, "main"], source);
      await commit(source, "feat: imported #Q7");
      await git(
        ["push", "--quiet", "--push-option=lore-import", remote, "main"],
        source,
      );
      await git(["push", "--quiet", remote, "main:feature"], source);

      expect(recorded.flatMap((it) => it.commits)).toEqual([]);
    });

    it("indexes a push's branches, a creation's included, through every parent (#Q4132)", async ({
      expect,
    }) => {
      const { owner, cloneUrl, repositoryId } = await aProject();
      const source = await aCheckout();
      const remote = withKey(cloneUrl, owner.key);
      await git(["push", "--quiet", remote, "main"], source);
      await git(["checkout", "--quiet", "-b", "feat/x"], source);
      await commit(source, "side");
      await git(["checkout", "--quiet", "main"], source);
      await commit(source, "main");
      await git(
        ["merge", "--quiet", "--no-ff", "-m", "merge", "feat/x"],
        source,
      );
      await git(["push", "--quiet", remote, "main", "feat/x"], source);
      const { stdout: tip } = await git(["rev-parse", "HEAD"], source);

      const index = ctx.alepha.inject(CodeCommitIndex);
      const log = await index.log(repositoryId, tip.trim());
      // Committed within one second: the set, not the order.
      expect(log.commits.map((it) => it.subject).sort()).toEqual([
        "first",
        "main",
        "merge",
        "side",
      ]);
      expect(await index.frontier(repositoryId)).toEqual([]);
    });

    it("reads only the refs the report says ok, inside side-band or not", ({
      expect,
    }) => {
      const pack = new GitReceivePack();
      const report = new Uint8Array([
        ...pack.pkt("unpack ok\n"),
        ...pack.pkt("ok refs/heads/main\n"),
        ...pack.pkt("ng refs/heads/other non-fast-forward\n"),
        ...pack.flush(),
      ]);
      const banded = new Uint8Array([
        ...pack.pkt(
          new Uint8Array([2, ...new TextEncoder().encode("progress\n")]),
        ),
        ...pack.pkt(new Uint8Array([1, ...report])),
        ...pack.flush(),
      ]);

      expect([...pack.acceptedRefs(report, ["report-status"])]).toEqual([
        "refs/heads/main",
      ]);
      expect([
        ...pack.acceptedRefs(banded, ["report-status", "side-band-64k"]),
      ]).toEqual(["refs/heads/main"]);
      expect(pack.acceptedRefs(new Uint8Array(0), []).size).toBe(0);
    });
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

  it("refuses a non-fast-forward push of the default branch, and lets a feature branch be force-pushed (#Q3953)", async ({
    expect,
  }) => {
    const { owner, cloneUrl } = await aProject();
    const source = await aCheckout();
    const remote = withKey(cloneUrl, owner.key);
    await git(["push", "--quiet", remote, "main"], source);
    const { stdout: pushed } = await git(["rev-parse", "HEAD"], source);

    // History rewritten: the amended commit is not a descendant of main's.
    await git(["commit", "--quiet", "--amend", "-m", "rewritten"], source);
    const refused = await git(
      ["push", "--force", remote, "main"],
      source,
    ).catch((error) => error as { stderr: string });
    expect(String((refused as { stderr: string }).stderr)).toMatch(
      /default branch main refuses a non-fast-forward push/,
    );
    await git(["clone", "--quiet", remote, "after"]);
    const { stdout: kept } = await git(
      ["rev-parse", "HEAD"],
      join(ctx.work, "after"),
    );
    expect(kept.trim()).toBe(pushed.trim());

    // Any other branch takes a force-push, and main a fast-forward.
    await git(["push", "--quiet", remote, "HEAD:feature"], source);
    await git(["commit", "--quiet", "--amend", "-m", "again"], source);
    await git(["push", "--quiet", "--force", remote, "HEAD:feature"], source);
    await git(["fetch", "--quiet", remote, "main"], source);
    await git(["reset", "--quiet", "--hard", "FETCH_HEAD"], source);
    await writeFile(join(source, "next.md"), "next\n");
    await git(["add", "next.md"], source);
    await git(["commit", "--quiet", "-m", "next"], source);
    await git(["push", "--quiet", remote, "main"], source);
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

  describe("with a job key (#Q3995)", () => {
    const mint = async (
      project: Awaited<ReturnType<typeof aProject>>,
      scope: { repositoryId?: string; writeRefPrefix?: string },
    ) => {
      const jobId = crypto.randomUUID();
      const token = await ctx.alepha.inject(JobKeyService).mint(
        {
          id: jobId,
          projectId: project.projectId,
          kind: "agent",
          status: "running",
          startedBy: project.owner.id,
          queuedAt: new Date().toISOString(),
          input: { profile: "push", maxTurns: 10, timeoutSeconds: 600 },
        },
        { tools: [], ...scope },
      );
      return { jobId, token };
    };

    it("pushes below its prefix only, and never to the default branch", async ({
      expect,
    }) => {
      const project = await aProject();
      const source = await aCheckout();
      await git(
        [
          "push",
          "--quiet",
          withKey(project.cloneUrl, project.owner.key),
          "main",
        ],
        source,
      );
      const { token } = await mint(project, {
        repositoryId: String(project.repositoryId),
        writeRefPrefix: "lore/q12",
      });
      const remote = withKey(project.cloneUrl, token);

      await git(["clone", "--quiet", remote, "job-clone"]);
      await git(["push", "--quiet", remote, "main:lore/q12"], source);
      // A new commit, so a push of main is a real update and not up to date.
      await writeFile(join(source, "README.md"), "second\n");
      await git(["commit", "--quiet", "-am", "second"], source);
      for (const ref of ["main", "main:lore/q13", "main:other"]) {
        const refused = await git(["push", remote, ref], source).catch(
          (error) => error as { stderr: string },
        );
        expect(String((refused as { stderr?: string }).stderr)).toMatch(
          /job key pushes to refs\/heads\/lore\/q12 only/,
        );
      }
    });

    it("reads one repository of one project, and pushes nothing without a prefix", async ({
      expect,
    }) => {
      const project = await aProject();
      const other = await aProject({ repo: "web" });
      const { token } = await mint(project, {
        repositoryId: String(project.repositoryId),
      });
      const auth = `Basic ${btoa(`x:${token}`)}`;
      const elsewhere = await fetch(
        `${new URL(other.cloneUrl).origin}${new URL(other.cloneUrl).pathname}/info/refs?service=git-upload-pack`,
        { headers: { authorization: auth } },
      );
      expect(elsewhere.status).toBe(404);
      const push = await fetch(
        `${project.cloneUrl}/info/refs?service=git-receive-pack`,
        { headers: { authorization: auth } },
      );
      expect(push.status).toBe(403);
    });

    it("is refused on any route but MCP and git, and dead once revoked", async ({
      expect,
    }) => {
      const project = await aProject();
      const { jobId, token } = await mint(project, {
        repositoryId: String(project.repositoryId),
      });
      const api = await fetch(`${ctx.baseUrl}/api/getMyProjects`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(api.status).toBe(403);
      await ctx.alepha.inject(JobKeyService).revoke(jobId);
      const clone = await fetch(
        `${project.cloneUrl}/info/refs?service=git-upload-pack`,
        { headers: { authorization: `Basic ${btoa(`x:${token}`)}` } },
      );
      expect(clone.status).toBe(401);
    });
  });

  it("answers 404 on a read and 400 on a write with Repositories off (#Q4005)", async ({
    expect,
  }) => {
    const { owner, slug } = await aProject({ repositories: false });
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
    expect(await write.text()).toContain("build.repositories");
  });
});
