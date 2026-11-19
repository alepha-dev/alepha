import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";

import {
  GitBackend,
  type GitBackendToken,
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
    const child = spawn(
      "git",
      [
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
