import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";

import {
  GitBackend,
  type GitBackendToken,
  type GitBlobResult,
  type GitCommit,
  type GitCommitDetail,
  type GitPerson,
  type GitReadOptions,
  type GitRefTip,
  type GitTreeEntry,
  type GitRepositoryInfo,
  type GitRpcRequest,
  type GitRpcResponse,
} from "./GitBackend.ts";

/**
 * Bare repositories on disk, for Lore on Node: the Docker image, `alepha
 * dev` and every spec (#E162).
 *
 * `${DATA_DIR}/git/<projectId>/<repoId>.git`, created with `git init --bare`
 * and served by spawning `git upload-pack` / `git receive-pack
 * --stateless-rpc` (`GitHttpService`). The `git` binary is in
 * `ghcr.io/alepha-dev/lore` for this.
 *
 * ⚠️ On Docker the repositories share the volume with the database: a full
 * disk stops both.
 *
 * `node:child_process` and `node:fs` are imported where they are used, never
 * at the top: this class is bundled into the Worker too, which never
 * constructs it.
 */
export class LocalGitBackend extends GitBackend {
  public readonly kind = "local";
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();

  /**
   * Where every repository lives: `${DATA_DIR}/git`, or under
   * `node_modules/.alepha` in development, as the framework's other local
   * stores do.
   */
  public root(): string {
    const dataDir = String(this.alepha.env.DATA_DIR || "node_modules/.alepha");
    return `${dataDir.replace(/\/+$/, "")}/git`;
  }

  /**
   * The repository's directory, from its ref.
   */
  public pathOf(ref: string): string {
    if (!/^\d+\/[0-9a-f-]{36}$/.test(ref)) {
      throw new AlephaError(`Not a local repository ref: ${ref}`);
    }
    return `${this.root()}/${ref}.git`;
  }

  /**
   * The `update` hook every receive-pack runs (#Q3953), through
   * `core.hooksPath` rather than each repository's `hooks/`, so the
   * repositories created before it are covered too. It refuses a
   * non-fast-forward of the branch `HEAD` names, the default branch, and
   * leaves every other ref alone: a feature branch may still be
   * force-pushed. A creation or a deletion is not its business (Lore
   * refuses deleting the default branch before the push reaches git).
   *
   * `receive.denyNonFastForwards` was the alternative, and it is too wide:
   * it refuses a force-push on every branch.
   */
  public static readonly UPDATE_HOOK = `#!/bin/sh
ref="$1"
old="$2"
new="$3"
zero=0000000000000000000000000000000000000000
[ "$old" = "$zero" ] && exit 0
[ "$new" = "$zero" ] && exit 0
head=$(git symbolic-ref -q HEAD) || exit 0
[ "$ref" = "$head" ] || exit 0
git merge-base --is-ancestor "$old" "$new" && exit 0
echo "the default branch \${head#refs/heads/} refuses a non-fast-forward push: pull, then push again" >&2
exit 1
`;

  /**
   * The directory of {@link LocalGitBackend.UPDATE_HOOK}, written once per
   * process beside the repositories.
   */
  protected hooksDir?: Promise<string>;

  protected async hooks(): Promise<string> {
    this.hooksDir ??= (async () => {
      const { chmod, mkdir, writeFile } = await import("node:fs/promises");
      const dir = `${this.root()}/.hooks`;
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/update`, LocalGitBackend.UPDATE_HOOK);
      await chmod(`${dir}/update`, 0o755);
      return dir;
    })();
    return await this.hooksDir;
  }

  public refFor(ids: { projectId: number; repoId: string }): string {
    return `${ids.projectId}/${ids.repoId}`;
  }

  public async create(
    ref: string,
    options: { defaultBranch: string },
  ): Promise<void> {
    const path = this.pathOf(ref);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path, { recursive: true });
    await this.git(["init", "--bare", "--quiet", path]);
    // `--initial-branch` needs git 2.28; writing HEAD works on every git.
    await this.git([
      "--git-dir",
      path,
      "symbolic-ref",
      "HEAD",
      `refs/heads/${options.defaultBranch}`,
    ]);
  }

  public async delete(ref: string): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(this.pathOf(ref), { recursive: true, force: true });
  }

  public async list(): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    const refs: string[] = [];
    const projects = await readdir(this.root()).catch(() => [] as string[]);
    for (const project of projects) {
      if (!/^\d+$/.test(project)) continue;
      const entries = await readdir(`${this.root()}/${project}`).catch(
        () => [] as string[],
      );
      for (const entry of entries) {
        if (entry.endsWith(".git")) {
          refs.push(`${project}/${entry.slice(0, -4)}`);
        }
      }
    }
    return refs.sort();
  }

  public async info(ref: string): Promise<GitRepositoryInfo | undefined> {
    const { readFile } = await import("node:fs/promises");
    const path = this.pathOf(ref);
    const head = await readFile(`${path}/HEAD`, "utf8").catch(() => undefined);
    if (head === undefined) {
      return undefined;
    }
    const branch = /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim();
    return {
      ref,
      defaultBranch: branch ?? "main",
      sizeBytes: await this.sizeOf(path),
    };
  }

  /**
   * No token: Lore serves a local repository itself, in process.
   */
  public async token(): Promise<GitBackendToken | undefined> {
    return undefined;
  }

  public async commits(
    ref: string,
    range: { from: string; to: string; limit: number },
  ): Promise<GitCommit[]> {
    if (
      !/^[0-9a-f]{40}$/.test(range.from) ||
      !/^[0-9a-f]{40}$/.test(range.to)
    ) {
      return [];
    }
    const out = await this.git([
      "--git-dir",
      this.pathOf(ref),
      "log",
      // One more than asked: a push over the limit answers nothing, as on
      // Artifacts, rather than part of itself.
      `--max-count=${range.limit + 1}`,
      "--format=%H%x1f%B%x1e",
      `${range.from}..${range.to}`,
    ]);
    const commits = out
      .split("\x1e")
      .map((entry) => entry.replace(/^\n/, ""))
      .filter((entry) => entry.includes("\x1f"))
      .map((entry) => {
        const at = entry.indexOf("\x1f");
        return {
          sha: entry.slice(0, at),
          message: entry.slice(at + 1).replace(/\n+$/, ""),
        };
      });
    return commits.length > range.limit ? [] : commits;
  }

  public async refs(ref: string): Promise<GitRefTip[]> {
    const path = this.pathOf(ref);
    const out = await this.git([
      "--git-dir",
      path,
      "for-each-ref",
      "--format=%(objectname) %(refname) %(*objectname)",
      "refs/heads",
      "refs/tags",
    ]);
    const tips = out
      .split("\n")
      .filter(Boolean)
      .map((line): GitRefTip => {
        const [sha = "", name = "", peeled = ""] = line.split(" ");
        return peeled ? { sha, name, targetSha: peeled } : { sha, name };
      });
    if (tips.length === 0) return [];
    const head = await this.git([
      "--git-dir",
      path,
      "rev-parse",
      "--verify",
      "--quiet",
      "HEAD",
    ]).catch(() => "");
    return head.trim() ? [{ sha: head.trim(), name: "HEAD" }, ...tips] : tips;
  }

  public async resolve(
    ref: string,
    revision: string,
  ): Promise<string | undefined> {
    const dir = this.pathOf(ref);
    const candidates = GitBackend.isSha(revision)
      ? [revision]
      : GitBackend.refCandidates(revision);
    for (const candidate of candidates) {
      const { code, out } = await this.run([
        "--git-dir",
        dir,
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        `${candidate}^{commit}`,
      ]);
      if (code === 0 && GitBackend.isSha(out.trim())) return out.trim();
    }
    return undefined;
  }

  public async tree(
    ref: string,
    commit: string,
    path: string,
  ): Promise<GitTreeEntry[] | undefined> {
    if (!GitBackend.isSha(commit)) return undefined;
    const clean = GitBackend.cleanPath(path);
    if (clean === undefined) return undefined;
    return this.lsTree(ref, clean ? `${commit}:${clean}` : `${commit}^{tree}`);
  }

  public async readTree(
    ref: string,
    treeSha: string,
  ): Promise<GitTreeEntry[] | undefined> {
    if (!GitBackend.isSha(treeSha)) return undefined;
    const { out } = await this.run(
      [
        "--git-dir",
        this.pathOf(ref),
        "cat-file",
        "--batch-check=%(objecttype)",
      ],
      `${treeSha}\n`,
    );
    // `ls-tree` takes a commit too, and peels it: a tree diff never wants that.
    if (out.trim() !== "tree") return undefined;
    return this.lsTree(ref, treeSha);
  }

  /**
   * `git ls-tree -z` of a tree-ish, parsed; undefined when git refuses it.
   */
  protected async lsTree(
    ref: string,
    treeish: string,
  ): Promise<GitTreeEntry[] | undefined> {
    const { code, out } = await this.run([
      "--git-dir",
      this.pathOf(ref),
      "ls-tree",
      "-z",
      "--end-of-options",
      treeish,
    ]);
    if (code !== 0) return undefined;
    return out
      .split("\0")
      .filter(Boolean)
      .map((record) => {
        const tab = record.indexOf("\t");
        const [mode = "", type = "", sha = ""] = record
          .slice(0, tab)
          .split(" ");
        return {
          name: record.slice(tab + 1),
          // `ls-tree` pads a tree's mode (`040000`); the object, and
          // Artifacts, write `40000`.
          mode: mode.replace(/^0(?=\d{5}$)/, ""),
          type: type as GitTreeEntry["type"],
          sha,
        };
      });
  }

  public async blob(
    ref: string,
    sha: string,
    options: GitReadOptions = {},
  ): Promise<GitBlobResult> {
    if (!GitBackend.isSha(sha)) return { kind: "not_found" };
    const dir = this.pathOf(ref);
    const { code, out } = await this.run(
      [
        "--git-dir",
        dir,
        "cat-file",
        "--batch-check=%(objecttype) %(objectsize)",
      ],
      `${sha}\n`,
    );
    const [type, size] = out.trim().split(" ");
    if (code !== 0 || type !== "blob") return { kind: "not_found" };
    return GitBackend.sized(Number(size), options.maxBytes, () =>
      this.gitBytes(["--git-dir", dir, "cat-file", "blob", sha]),
    );
  }

  public async file(
    ref: string,
    commit: string,
    path: string,
    options: GitReadOptions = {},
  ): Promise<GitBlobResult> {
    const clean = GitBackend.cleanPath(path);
    if (!GitBackend.isSha(commit) || !clean) return { kind: "not_found" };
    const { code, out } = await this.run([
      "--git-dir",
      this.pathOf(ref),
      "ls-tree",
      "-z",
      "--end-of-options",
      commit,
      "--",
      clean,
    ]);
    const record = out.split("\0")[0] ?? "";
    const tab = record.indexOf("\t");
    const [, type, sha = ""] = record.slice(0, tab).split(" ");
    if (code !== 0 || type !== "blob" || record.slice(tab + 1) !== clean) {
      return { kind: "not_found" };
    }
    return this.blob(ref, sha, options);
  }

  /**
   * The raw commit object (`git cat-file commit`), parsed: exact where a
   * `--format` would re-encode or wrap.
   */
  public async commit(
    ref: string,
    sha: string,
  ): Promise<GitCommitDetail | undefined> {
    if (!GitBackend.isSha(sha)) return undefined;
    const { code, out } = await this.run([
      "--git-dir",
      this.pathOf(ref),
      "cat-file",
      "commit",
      sha,
    ]);
    if (code !== 0) return undefined;
    return LocalGitBackend.parseCommit(sha, out);
  }

  /**
   * A commit object's text: its headers up to the first blank line, the
   * message after it.
   */
  public static parseCommit(sha: string, raw: string): GitCommitDetail {
    const at = raw.indexOf("\n\n");
    const headers = (at === -1 ? raw : raw.slice(0, at)).split("\n");
    const parents: string[] = [];
    let treeSha = "";
    const people: Record<string, GitPerson> = {};
    for (const line of headers) {
      if (line.startsWith(" ")) continue;
      const space = line.indexOf(" ");
      const key = line.slice(0, space);
      const value = line.slice(space + 1);
      if (key === "tree") treeSha = value;
      else if (key === "parent") parents.push(value);
      else if (key === "author" || key === "committer") {
        const match = /^(.*?) <([^>]*)> (\d+) [+-]\d{4}$/.exec(value);
        people[key] = {
          name: match?.[1] ?? value,
          email: match?.[2] ?? "",
          at: Number(match?.[3] ?? 0),
        };
      }
    }
    const nobody: GitPerson = { name: "", email: "", at: 0 };
    return {
      sha,
      parents,
      treeSha,
      author: people.author ?? nobody,
      committer: people.committer ?? people.author ?? nobody,
      ...GitBackend.splitMessage(at === -1 ? "" : raw.slice(at + 2)),
    };
  }

  public async mergeBase(
    ref: string,
    a: string,
    b: string,
    _options?: { maxReads?: number },
  ): Promise<{ kind: "ok"; sha: string | undefined } | { kind: "cap" }> {
    if (!GitBackend.isSha(a) || !GitBackend.isSha(b)) {
      return { kind: "ok", sha: undefined };
    }
    const { code, out } = await this.run([
      "--git-dir",
      this.pathOf(ref),
      "merge-base",
      a,
      b,
    ]);
    return { kind: "ok", sha: code === 0 ? out.trim() : undefined };
  }

  public async isAncestor(
    ref: string,
    ancestor: string,
    tip: string,
    _options?: { maxReads?: number },
  ): Promise<{ kind: "ok"; value: boolean } | { kind: "cap" }> {
    if (!GitBackend.isSha(ancestor) || !GitBackend.isSha(tip)) {
      return { kind: "ok", value: false };
    }
    const { code } = await this.run([
      "--git-dir",
      this.pathOf(ref),
      "merge-base",
      "--is-ancestor",
      ancestor,
      tip,
    ]);
    return { kind: "ok", value: code === 0 };
  }

  public async deleteRef(
    ref: string,
    refName: string,
    oldSha: string,
  ): Promise<void> {
    GitBackend.assertDeletable(refName, oldSha);
    const { code, err } = await this.run([
      "--git-dir",
      this.pathOf(ref),
      "update-ref",
      "-d",
      refName,
      oldSha,
    ]);
    if (code !== 0) {
      throw new AlephaError(`Could not delete ${refName}: ${err.trim()}`);
    }
  }

  /**
   * `git bundle create - --all`, streamed from the child's stdout.
   */
  public async bundle(ref: string): Promise<ReadableStream<Uint8Array>> {
    const { spawn } = await import("node:child_process");
    const { Readable } = await import("node:stream");
    const child = spawn(
      "git",
      [
        "--git-dir",
        this.pathOf(ref),
        "bundle",
        "create",
        "--quiet",
        "-",
        "--all",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (code) {
        this.log.warn(`git bundle exited ${code}`, {
          ref,
          stderr: stderr.slice(0, 2000),
        });
      }
    });
    return Readable.toWeb(
      child.stdout,
    ) as unknown as ReadableStream<Uint8Array>;
  }

  /**
   * Spawn `git upload-pack|receive-pack --stateless-rpc` on the repository,
   * as `git http-backend` would: the request body into its stdin, its
   * stdout as the response, the child killed when the client goes away.
   *
   * The advertisement starts with the `# service=` pkt-line a smart HTTP
   * client expects, unless the client asked for protocol v2, whose
   * capability advertisement has none.
   */
  public async serve(ref: string, rpc: GitRpcRequest): Promise<GitRpcResponse> {
    const path = this.pathOf(ref);
    const { spawn } = await import("node:child_process");
    const { Readable } = await import("node:stream");
    const env: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "LANG", "TMPDIR"]) {
      const value = globalThis.process?.env?.[key];
      if (value) env[key] = value;
    }
    if (rpc.gitProtocol) env.GIT_PROTOCOL = rpc.gitProtocol;
    // A push runs Lore's own `update` hook (#Q3953).
    const hooked =
      rpc.service === "git-receive-pack" && !rpc.advertise
        ? ["-c", `core.hooksPath=${await this.hooks()}`]
        : [];
    const child = spawn(
      "git",
      [
        ...hooked,
        rpc.service.slice("git-".length),
        "--stateless-rpc",
        ...(rpc.advertise ? ["--advertise-refs"] : []),
        path,
      ],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    const kill = () => child.kill("SIGTERM");
    rpc.signal?.addEventListener("abort", kill, { once: true });
    child.on("close", () => rpc.signal?.removeEventListener("abort", kill));
    child.on("error", () => kill());
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (code && !rpc.signal?.aborted) {
        this.log.warn(`git ${rpc.service} exited ${code}`, {
          ref,
          stderr: stderr.slice(0, 2000),
        });
      }
    });
    if (rpc.body && !rpc.advertise) {
      Readable.fromWeb(rpc.body as never)
        .on("error", kill)
        .pipe(child.stdin);
    } else {
      child.stdin.end();
    }
    const out = Readable.toWeb(
      child.stdout,
    ) as unknown as ReadableStream<Uint8Array>;
    const body =
      rpc.advertise && !/version=2/.test(rpc.gitProtocol ?? "")
        ? this.prefixed(this.serviceLine(rpc.service), out)
        : out;
    return {
      status: 200,
      contentType: rpc.advertise
        ? `application/x-${rpc.service}-advertisement`
        : `application/x-${rpc.service}-result`,
      body,
    };
  }

  /**
   * `# service=<service>` as a pkt-line, then a flush.
   */
  protected serviceLine(service: string): Uint8Array {
    const line = `# service=${service}\n`;
    const length = (line.length + 4).toString(16).padStart(4, "0");
    return new TextEncoder().encode(`${length}${line}0000`);
  }

  /**
   * A stream that emits `head`, then everything `rest` emits.
   */
  protected prefixed(
    head: Uint8Array,
    rest: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    const reader = rest.getReader();
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (!sent) {
          sent = true;
          controller.enqueue(head);
          return;
        }
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    });
  }

  /**
   * Bytes under a directory, summed file by file.
   */
  protected async sizeOf(path: string): Promise<number> {
    const { readdir, stat } = await import("node:fs/promises");
    let total = 0;
    const entries = await readdir(path, {
      withFileTypes: true,
      recursive: true,
    });
    for (const entry of entries) {
      if (entry.isFile()) {
        const parent = (entry as { parentPath?: string }).parentPath ?? path;
        total += (await stat(`${parent}/${entry.name}`)).size;
      }
    }
    return total;
  }

  /**
   * Run `git` to completion and answer its exit code beside its output,
   * for the commands whose non-zero exit is an answer (`merge-base`,
   * `rev-parse --verify`). `input` is written to its stdin.
   */
  public async run(
    args: string[],
    input?: string,
  ): Promise<{ code: number; out: string; err: string }> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout!.on("data", (chunk) => (out += chunk));
      child.stderr!.on("data", (chunk) => (err += chunk));
      child.on("error", (error) =>
        reject(
          new AlephaError(
            `Cannot run git (${error.message}). Lore on Node needs the git binary on its PATH.`,
          ),
        ),
      );
      child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
      if (input !== undefined) child.stdin?.end(input);
    });
  }

  /**
   * Run `git` and answer its stdout as bytes, for a blob.
   */
  protected async gitBytes(args: string[]): Promise<Uint8Array> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Uint8Array[] = [];
      let err = "";
      child.stdout.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new AlephaError(`git ${args.at(-2)} failed: ${err.trim()}`));
          return;
        }
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(bytes);
      });
    });
  }

  /**
   * Run `git` to completion, refusing on a non-zero exit with its stderr.
   */
  public async git(args: string[], options: { cwd?: string } = {}) {
    const { spawn } = await import("node:child_process");
    return new Promise<string>((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("error", (error) =>
        reject(
          new AlephaError(
            `Cannot run git (${error.message}). Lore on Node needs the git binary on its PATH.`,
          ),
        ),
      );
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else
          reject(
            new AlephaError(`git ${args[0]} failed (${code}): ${err.trim()}`),
          );
      });
    });
  }
}
