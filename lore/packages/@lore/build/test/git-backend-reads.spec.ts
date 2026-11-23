import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Alepha } from "alepha";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  type ArtifactsBinding,
  type ArtifactsCommit,
  ArtifactsGitBackend,
  type ArtifactsRepoHandle,
  type ArtifactsTreeEntry,
  GitBackend,
  LocalGitBackend,
} from "../src/api/index.ts";
import {
  assertGitBackendContract,
  buildContractFixture,
  type GitContractFixture,
  pushContractFixture,
} from "./git-backend-contract.ts";

/**
 * The reads of #Q4131 on both backends, by one set of assertions
 * (`git-backend-contract.ts`), which `test/artifacts-contract.ts` also runs
 * against a real Artifacts namespace by hand.
 *
 * Here Artifacts is played by git: the binding's `readTree`, `readBlob`,
 * `readCommit` and `log` read a bare repository, answering in the shapes
 * Cloudflare's types give (`ArtifactsTreeEntry`, `ArtifactsCommitMetadata`),
 * and the advertisement is `git upload-pack --advertise-refs`.
 */
const run = promisify(execFile);

class GitPlayedBinding implements ArtifactsBinding {
  public readonly bare: string;
  public reads = 0;

  constructor(bare: string) {
    this.bare = bare;
  }

  protected async git(...args: string[]) {
    const { stdout } = await run("git", ["--git-dir", this.bare, ...args], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout as Buffer;
  }

  protected async typeOf(hash: string) {
    try {
      return (await this.git("cat-file", "-t", hash)).toString().trim();
    } catch {
      return undefined;
    }
  }

  async create(name: string) {
    return { name, remote: `http://artifacts.test/${name}.git`, token: "t" };
  }

  async get(name: string): Promise<ArtifactsRepoHandle> {
    const readCommit = async (
      hash: string,
    ): Promise<ArtifactsCommit | null> => {
      this.reads += 1;
      if ((await this.typeOf(hash)) !== "commit") return null;
      const raw = (await this.git("cat-file", "commit", hash)).toString();
      const parsed = LocalGitBackend.parseCommit(hash, raw);
      const at = raw.indexOf("\n\n");
      return {
        hash,
        treeHash: parsed.treeSha,
        message: raw.slice(at + 2).replace(/\n$/, ""),
        author: { name: parsed.author.name, email: parsed.author.email },
        committer: {
          name: parsed.committer.name,
          email: parsed.committer.email,
        },
        parents: parsed.parents,
        authoredAt: parsed.author.at,
        committedAt: parsed.committer.at,
      };
    };
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
        const out = (
          await this.git(
            "log",
            "--first-parent",
            `-n${options.limit ?? 50}`,
            `--skip=${options.offset ?? 0}`,
            "--format=%H",
            options.ref ?? "HEAD",
          )
        )
          .toString()
          .split("\n")
          .filter(Boolean);
        return (await Promise.all(out.map(readCommit))).filter(
          (it): it is ArtifactsCommit => it !== null,
        );
      },
      readCommit,
      readTree: async (hash) => {
        if ((await this.typeOf(hash)) !== "tree") return null;
        const out = (await this.git("ls-tree", "-z", hash)).toString();
        return out
          .split("\0")
          .filter(Boolean)
          .map((record): ArtifactsTreeEntry => {
            const tab = record.indexOf("\t");
            const [mode = "", , sha = ""] = record.slice(0, tab).split(" ");
            const canonical = mode.replace(/^0/, "");
            return {
              name: record.slice(tab + 1),
              mode: canonical,
              hash: sha,
              type:
                canonical === "40000"
                  ? "tree"
                  : canonical === "160000"
                    ? "gitlink"
                    : canonical === "120000"
                      ? "symlink"
                      : canonical === "100755"
                        ? "exec"
                        : "blob",
            };
          });
      },
      readBlob: async (hash) => {
        if ((await this.typeOf(hash)) !== "blob") return null;
        return new Blob([
          new Uint8Array(await this.git("cat-file", "blob", hash)),
        ]);
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

class GitPlayedArtifactsBackend extends ArtifactsGitBackend {
  protected override async fetchUpstream(url: string) {
    const bare = (
      this.alepha.store.get("cloudflare.env" as never) as unknown as {
        ARTIFACTS: GitPlayedBinding;
      }
    ).ARTIFACTS.bare;
    const child = spawn("git", [
      "upload-pack",
      "--stateless-rpc",
      "--advertise-refs",
      bare,
    ]);
    child.stdin.end();
    const chunks: Buffer[] = [];
    for await (const chunk of child.stdout) chunks.push(chunk as Buffer);
    const line = "# service=git-upload-pack\n";
    const pkt = `${(line.length + 4).toString(16).padStart(4, "0")}${line}0000`;
    void url;
    return new Response(Buffer.concat([Buffer.from(pkt), ...chunks]));
  }
}

interface Context {
  work: string;
  fixture: GitContractFixture;
  local: LocalGitBackend;
  localRef: string;
  artifacts: GitPlayedArtifactsBackend;
  binding: GitPlayedBinding;
}

describe("GitBackend reads (#Q4131)", () => {
  let ctx: Context;

  beforeAll(async () => {
    const work = await mkdtemp(join(tmpdir(), "lore-git-reads-"));
    const fixture = buildContractFixture(work);

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATA_DIR: join(work, "data") },
    });
    const local = alepha.inject(LocalGitBackend);
    const localRef = local.refFor({
      projectId: 1,
      repoId: crypto.randomUUID(),
    });
    await local.create(localRef, { defaultBranch: "main" });
    pushContractFixture(work, fixture, local.pathOf(localRef));

    const bare = join(work, "artifacts.git");
    execFileSync("git", ["init", "--bare", "--quiet", bare]);
    execFileSync("git", [
      "--git-dir",
      bare,
      "symbolic-ref",
      "HEAD",
      "refs/heads/main",
    ]);
    pushContractFixture(work, fixture, bare);
    const played = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const binding = new GitPlayedBinding(bare);
    played.set("cloudflare.env" as never, { ARTIFACTS: binding } as never);

    ctx = {
      work,
      fixture,
      local,
      localRef,
      artifacts: played.inject(GitPlayedArtifactsBackend),
      binding,
    };
  });

  afterAll(async () => {
    await rm(ctx.work, { recursive: true, force: true });
  });

  it("LocalGitBackend answers the contract", async () => {
    await assertGitBackendContract(ctx.local, ctx.localRef, ctx.fixture);
  });

  it("ArtifactsGitBackend answers the same contract through the binding", async () => {
    await assertGitBackendContract(ctx.artifacts, "1-a", ctx.fixture);
  });

  it("caps a walk by its reads on Artifacts, and git answers without one", async ({
    expect,
  }) => {
    const { fixture } = ctx;
    expect(
      await ctx.artifacts.mergeBase("1-a", fixture.main, fixture.side, {
        maxReads: 1,
      }),
    ).toEqual({ kind: "cap" });
    expect(
      await ctx.artifacts.isAncestor("1-a", fixture.side, fixture.main, {
        maxReads: 0,
      }),
    ).toEqual({ kind: "cap" });
    expect(
      await ctx.local.mergeBase(ctx.localRef, fixture.main, fixture.side, {
        maxReads: 1,
      }),
    ).toEqual({ kind: "ok", sha: fixture.second });
  });

  it("checks a blob's size before reading its bytes on Artifacts", async ({
    expect,
  }) => {
    let read = false;
    const blob = new Blob(["x".repeat(100)]);
    const spy = Object.assign(blob, {
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    });
    const answer = await (
      ctx.artifacts as unknown as {
        readSized: (
          read: () => Promise<Blob>,
          options: { maxBytes: number },
        ) => Promise<unknown>;
      }
    ).readSized(async () => spy, { maxBytes: 10 });
    expect(answer).toEqual({ kind: "too_large", size: 100 });
    expect(read).toBe(false);
  });

  it("reads git's binary rule: a NUL in the first 8,000 bytes", ({
    expect,
  }) => {
    const late = new Uint8Array(9000).fill(65);
    late[8500] = 0;
    const early = new Uint8Array(9000).fill(65);
    early[7999] = 0;
    expect(GitBackend.isBinary(late)).toBe(false);
    expect(GitBackend.isBinary(early)).toBe(true);
  });

  it("cuts a message into subject and body as git's %s and %b do", ({
    expect,
  }) => {
    expect(GitBackend.splitMessage("one\ntwo\n\nbody\n\n")).toEqual({
      message: "one\ntwo\n\nbody",
      subject: "one two",
      body: "body",
    });
    expect(GitBackend.splitMessage("alone\n").body).toBe("");
  });

  it("peels an annotated tag from the advertisement", ({ expect }) => {
    const pkt = (line: string) =>
      `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
    const bytes = new TextEncoder().encode(
      `${pkt(`${"a".repeat(40)} refs/tags/v1\n`)}${pkt(`${"b".repeat(40)} refs/tags/v1^{}\n`)}${pkt(`${"c".repeat(40)} refs/heads/main\n`)}0000`,
    );
    expect(ArtifactsGitBackend.advertisedRefs(bytes)).toEqual([
      { sha: "a".repeat(40), name: "refs/tags/v1", targetSha: "b".repeat(40) },
      { sha: "c".repeat(40), name: "refs/heads/main" },
    ]);
  });
});
