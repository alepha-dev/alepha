import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";

import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type ArtifactsBinding,
  type ArtifactsCommit,
  ArtifactsGitBackend,
  type ArtifactsRepoHandle,
} from "../src/api/index.ts";

/**
 * The default branch only moves forward on Artifacts (#Q3953).
 *
 * Artifacts itself is played by real git: `git receive-pack
 * --stateless-rpc` on a bare repository answers the proxied requests, and
 * the binding's `log` and `readCommit` read the same repository. Like
 * Artifacts (measured on 2026-11-22), it takes any ref, a command-only
 * update, and refuses a command whose old id is stale. A real git client
 * pushes through a small HTTP server in front of `backend.serve`, so the
 * report Lore rewrites is read by git itself.
 */
const run = promisify(execFile);

const env = (home: string) => ({
  PATH: process.env.PATH,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "lore",
  GIT_AUTHOR_EMAIL: "lore@example.com",
  GIT_COMMITTER_NAME: "lore",
  GIT_COMMITTER_EMAIL: "lore@example.com",
});

class BareRepoBinding implements ArtifactsBinding {
  protected readonly bare: string;
  protected readonly home: string;

  constructor(bare: string, home: string) {
    this.bare = bare;
    this.home = home;
  }

  protected async git(...args: string[]) {
    const { stdout } = await run("git", ["-C", this.bare, ...args], {
      env: env(this.home),
    });
    return stdout;
  }

  protected parse(record: string): ArtifactsCommit {
    const [hash, parents, committedAt, message] = record.split("\x1f");
    return {
      hash: hash!,
      parents: parents ? parents.split(" ") : [],
      committedAt: Number(committedAt),
      message: message ?? "",
    };
  }

  async create(name: string) {
    return { name, remote: `http://artifacts.test/${name}.git`, token: "t" };
  }

  async get(name: string): Promise<ArtifactsRepoHandle> {
    const format = "--format=%H%x1f%P%x1f%ct%x1f%s%x1e";
    return {
      info: async () => ({
        defaultBranch: "main",
        remote: `http://artifacts.test/${name}.git`,
      }),
      createToken: async (scope) => ({
        plaintext: `art_${scope}`,
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      log: async (options) => {
        const out = await this.git(
          "log",
          "--first-parent",
          `-n${options.limit ?? 50}`,
          `--skip=${options.offset ?? 0}`,
          format,
          options.ref ?? "HEAD",
        );
        return out
          .split("\x1e")
          .map((it) => it.trim())
          .filter(Boolean)
          .map((it) => this.parse(it));
      },
      readCommit: async (hash) => {
        try {
          const out = await this.git("show", "-s", format, hash);
          return this.parse(out.split("\x1e")[0]!.trim());
        } catch {
          return null;
        }
      },
    };
  }

  async list() {
    return { repos: [] };
  }

  async delete() {
    return true;
  }
}

/**
 * The backend, its upstream answered by `git receive-pack` on the bare
 * repository rather than by Artifacts' remote.
 */
const backendOver = (
  bare: string,
  home: string,
  hooks: { beforeMove?: () => Promise<void> },
) => {
  class GitUpstreamBackend extends ArtifactsGitBackend {
    protected override async ancestry(
      ref: string,
      ancestor: string,
      tip: string,
    ) {
      const answer = await super.ancestry(ref, ancestor, tip);
      await hooks.beforeMove?.();
      return answer;
    }

    protected override async fetchUpstream(url: string, init: RequestInit) {
      const service = /(git-upload-pack|git-receive-pack)/.exec(url)![1]!;
      const advertise = url.includes("/info/refs");
      const child = spawn(
        "git",
        [
          service.slice(4),
          "--stateless-rpc",
          ...(advertise ? ["--advertise-refs"] : []),
          bare,
        ],
        { env: env(home) },
      );
      if (init.body) {
        Readable.fromWeb(init.body as never).pipe(child.stdin);
      } else {
        child.stdin.end();
      }
      const chunks: Buffer[] = [];
      for await (const chunk of child.stdout) chunks.push(chunk as Buffer);
      let body = Buffer.concat(chunks);
      if (advertise) {
        const line = `# service=${service}\n`;
        const pkt = `${(line.length + 4).toString(16).padStart(4, "0")}${line}0000`;
        body = Buffer.concat([Buffer.from(pkt), body]);
      }
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": advertise
            ? `application/x-${service}-advertisement`
            : `application/x-${service}-result`,
        },
      });
    }
  }
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.set(
    "cloudflare.env" as never,
    { ARTIFACTS: new BareRepoBinding(bare, home) } as never,
  );
  return alepha.inject(GitUpstreamBackend);
};

interface Context {
  hooks: { beforeMove?: () => Promise<void> };
  work: string;
  bare: string;
  server: Server;
  url: string;
}

describe("ArtifactsGitBackend, the default branch", () => {
  let ctx: Context;

  const git = async (args: string[], cwd = ctx.work) =>
    run("git", ["-c", "credential.helper=", ...args], {
      cwd,
      env: env(ctx.work),
    });

  const commit = async (cwd: string, name: string) => {
    await run("sh", ["-c", `echo ${name} > ${name}.txt`], { cwd });
    await git(["add", `${name}.txt`], cwd);
    await git(["commit", "-qm", name], cwd);
    return (await git(["rev-parse", "HEAD"], cwd)).stdout.trim();
  };

  const remoteRefs = async () =>
    (
      await git([
        "-C",
        ctx.bare,
        "for-each-ref",
        "--format=%(refname) %(objectname)",
      ])
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);

  const pushFails = async (args: string[], cwd: string) => {
    try {
      await git(args, cwd);
    } catch (error) {
      return String((error as { stderr?: string }).stderr);
    }
    throw new Error(`git ${args.join(" ")} succeeded`);
  };

  beforeEach(async () => {
    const work = await mkdtemp(join(tmpdir(), "lore-artifacts-ff-"));
    const bare = join(work, "remote.git");
    await run("git", ["init", "-q", "--bare", "-b", "main", bare], {
      env: env(work),
    });
    const hooks: Context["hooks"] = {};
    const backend = backendOver(bare, work, hooks);
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://lore.test");
      const advertise = url.pathname.endsWith("/info/refs");
      const service = (
        advertise
          ? url.searchParams.get("service")
          : url.pathname.split("/").pop()
      ) as "git-upload-pack" | "git-receive-pack";
      const response = await backend.serve("1-r", {
        service,
        advertise,
        body: advertise
          ? undefined
          : (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>),
        defaultBranch: "main",
      });
      res.statusCode = response.status;
      if (response.contentType) {
        res.setHeader("content-type", response.contentType);
      }
      if (typeof response.body === "string") {
        res.end(response.body);
        return;
      }
      Readable.fromWeb(response.body as never).pipe(res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    ctx = {
      hooks,
      work,
      bare,
      server,
      url: `http://127.0.0.1:${port}/r.git`,
    };
  });

  afterEach(async () => {
    await new Promise((resolve) => ctx.server.close(resolve));
    await rm(ctx.work, { recursive: true, force: true });
  });

  const seeded = async () => {
    const local = join(ctx.work, "local");
    await git(["init", "-q", "-b", "main", local]);
    const first = await commit(local, "a");
    const second = await commit(local, "b");
    await git(["push", "-q", ctx.url, "main"], local);
    return { local, first, second };
  };

  it("fast-forwards the default branch and leaves no incoming ref", async ({
    expect,
  }) => {
    const { local } = await seeded();
    const third = await commit(local, "c");

    await git(["push", "-q", ctx.url, "main"], local);

    expect(await remoteRefs()).toEqual([`refs/heads/main ${third}`]);
  });

  it("refuses a force-push of the default branch, which stays where it was", async ({
    expect,
  }) => {
    const { local, first, second } = await seeded();
    await git(["reset", "-q", "--hard", first], local);
    await commit(local, "rewritten");

    const stderr = await pushFails(["push", "--force", ctx.url, "main"], local);

    expect(stderr).toContain(
      "the default branch main refuses a non-fast-forward push",
    );
    expect(await remoteRefs()).toEqual([`refs/heads/main ${second}`]);
  });

  it("takes a fast-forward whose old tip is a merge's second parent", async ({
    expect,
  }) => {
    const { local, first, second } = await seeded();
    await git(["checkout", "-q", "-b", "work", first], local);
    await commit(local, "side");
    await git(["merge", "-q", "--no-edit", second], local);
    const merge = (await git(["rev-parse", "HEAD"], local)).stdout.trim();

    await git(["push", "-q", ctx.url, "work:main"], local);

    expect(await remoteRefs()).toEqual([`refs/heads/main ${merge}`]);
  });

  it("lets another branch be force-pushed, in the same push as a refused default branch", async ({
    expect,
  }) => {
    const { local, first, second } = await seeded();
    await git(["push", "-q", ctx.url, "main:feature"], local);
    await git(["reset", "-q", "--hard", first], local);
    const rewritten = await commit(local, "rewritten");

    const stderr = await pushFails(
      ["push", "--force", ctx.url, "main:feature", "main:main"],
      local,
    );

    expect(stderr).toContain("refuses a non-fast-forward push");
    expect(await remoteRefs()).toEqual([
      `refs/heads/feature ${rewritten}`,
      `refs/heads/main ${second}`,
    ]);
  });

  it("refuses a fast-forward when the branch moved during the check", async ({
    expect,
  }) => {
    const { local, second } = await seeded();
    const other = join(ctx.work, "other");
    await git(["clone", "-q", ctx.url, other]);
    const theirs = await commit(other, "theirs");
    // Their commit reaches the repository behind Lore's back, unreferenced.
    await git(["push", "-q", ctx.bare, "main:refs/heads/theirs"], other);
    await git(["-C", ctx.bare, "update-ref", "-d", "refs/heads/theirs"]);
    await commit(local, "mine");
    ctx.hooks.beforeMove = () =>
      git([
        "-C",
        ctx.bare,
        "update-ref",
        "refs/heads/main",
        theirs,
        second,
      ]).then(() => undefined);

    const stderr = await pushFails(["push", ctx.url, "main"], local);

    expect(stderr).toContain("main -> main");
    expect(await remoteRefs()).toEqual([`refs/heads/main ${theirs}`]);
  });

  it("creates the default branch on a first push, untouched by the check", async ({
    expect,
  }) => {
    const { second } = await seeded();
    expect(await remoteRefs()).toEqual([`refs/heads/main ${second}`]);
  });
});
