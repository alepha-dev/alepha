import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  type ArtifactsBinding,
  type ArtifactsCommit,
  ArtifactsGitBackend,
  type ArtifactsRepoHandle,
  type ArtifactsTreeEntry,
  LocalGitBackend,
} from "../../src/api/index.ts";

/**
 * Cloudflare Artifacts, played by git (#Q4131): the binding's `readTree`,
 * `readBlob`, `readCommit` and `log` read a bare repository, answering in
 * the shapes Cloudflare's types give (`ArtifactsTreeEntry`,
 * `ArtifactsCommitMetadata`), and the advertisement is `git upload-pack
 * --advertise-refs`. What lets a spec run the same reads on both backends;
 * `test/artifacts-contract.ts` runs them on the real one.
 */
const run = promisify(execFile);

export class GitPlayedBinding implements ArtifactsBinding {
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

export class GitPlayedArtifactsBackend extends ArtifactsGitBackend {
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
