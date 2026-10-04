import { rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";

import { $env, $inject, Alepha } from "alepha";
import { $logger, type LogEntry } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { inspectorEnvSchema } from "../schemas/inspectorEnvSchema.ts";
import type { InspectorRun } from "../schemas/InspectorRun.ts";
import {
  type InspectorRunEntry,
  inspectorRunEntrySchema,
} from "../schemas/InspectorRunEntry.ts";

/**
 * The run registry, read side: where inspectable processes announce
 * themselves, and the list of the ones still running.
 *
 * Discovery without port scanning. Each process with the inspector writes
 * `<runDir>/<runId>.json` on start and removes it on stop
 * (`InspectorRunProvider`); a tool lists the directory. Side-effect free, so a
 * tool that is not itself an app (the devtools server, a script) injects this
 * alone.
 */
export class InspectorRegistry {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly env = $env(inspectorEnvSchema);

  /**
   * How long a liveness probe waits on a socket that neither accepts nor
   * refuses.
   */
  protected readonly connectTimeoutMs = 500;

  /**
   * Whether `ALEPHA_RUN_DIR` names the directory, rather than the default.
   */
  public get explicitDirectory(): boolean {
    return !!this.env.ALEPHA_RUN_DIR;
  }

  /**
   * The run directory: `ALEPHA_RUN_DIR`, else `~/.alepha/run`.
   */
  public directory(): string {
    return this.env.ALEPHA_RUN_DIR
      ? this.fs.resolve(this.env.ALEPHA_RUN_DIR)
      : this.fs.join(homedir(), ".alepha", "run");
  }

  /**
   * The runs a tool should show, oldest first: every live one, and the last
   * dead run of each app while its log file exists.
   *
   * Alive means its socket accepts a connection. Not the pid: a container's
   * pid means nothing on the host (every container's main process is pid 1),
   * and a pid can be reused by an unrelated process. The connect covers both.
   *
   * Dead runs are kept for their logs, one per app (keyed by `cwd`): a newer
   * run of the same app, live or dead, replaces it. A dead run with no log
   * file left is not worth showing.
   */
  public async discover(): Promise<InspectorRun[]> {
    const runs = await this.list();
    const kept: InspectorRun[] = [];
    for (const run of runs) {
      if (run.status === "live" || (await this.retains(run, runs))) {
        kept.push(run);
      }
    }
    return kept;
  }

  /**
   * Every entry in the run directory, probed, oldest first.
   *
   * A file that does not parse as an entry is skipped rather than fatal: a
   * reader can catch a writer mid-write, and one torn file must not hide the
   * other apps.
   */
  public async list(): Promise<InspectorRun[]> {
    const dir = this.directory();

    let files: string[];
    try {
      if (!(await this.fs.exists(dir))) return [];
      files = (await this.fs.ls(dir)).filter((f) => f.endsWith(".json"));
    } catch (error) {
      this.log.debug("Could not list the inspector run directory", {
        dir,
        error,
      });
      return [];
    }

    const runs: InspectorRun[] = [];
    for (const name of files) {
      const file = this.fs.join(dir, name);
      const entry = await this.read(file);
      if (!entry) continue;
      // The writer's own absolute path means nothing here when the writer
      // was a container: only the name is trusted, against this directory.
      const socketPath = this.fs.join(dir, this.basename(entry.socket));
      runs.push({ ...entry, file, socketPath, status: "dead" });
    }

    const probes = await Promise.all(runs.map((run) => this.probe(run)));
    runs.forEach((run, index) => {
      run.status = probes[index] === "live" ? "live" : "dead";
    });

    return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  /**
   * Delete the entries `discover()` would no longer show, and their sockets.
   *
   * Only runs whose socket was refused outright are touched: a probe that
   * timed out may be a live process too busy to answer, and deleting its
   * entry would hide it for good.
   */
  public async prune(): Promise<void> {
    const runs = await this.list();
    for (const run of runs) {
      if (run.status === "live" || (await this.retains(run, runs))) continue;
      if ((await this.probe(run)) !== "refused") continue;
      await this.fs.rm(run.file, { force: true }).catch(() => undefined);
      await rm(run.socketPath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * The newest entries of a run's persisted log file, newest first, read
   * straight from disk: a dead run has no socket to ask.
   *
   * Malformed lines are skipped, since the last line of a crashed process's
   * file is routinely torn. `seq` is the line's position in the file.
   */
  public async readLogFile(
    run: Pick<InspectorRun, "logFile">,
    options: { limit?: number } = {},
  ): Promise<Array<LogEntry & { seq: number }>> {
    if (!run.logFile) return [];

    let text: string;
    try {
      text = await this.fs.readTextFile(run.logFile);
    } catch {
      return [];
    }

    const entries: Array<LogEntry & { seq: number }> = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (typeof entry?.timestamp !== "number") continue;
        entries.push({ ...entry, seq: entries.length });
      } catch {
        // torn line
      }
    }

    return entries.toReversed().slice(0, options.limit ?? 100);
  }

  /**
   * One entry file, or `undefined` when it is missing, torn, or not an entry.
   */
  public async read(file: string): Promise<InspectorRunEntry | undefined> {
    try {
      const raw = await this.fs.readJsonFile(file);
      return this.alepha.codec.validate(inspectorRunEntrySchema, raw);
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Whether a dead run is still worth showing: its log file exists, and no
   * newer run of the same app replaced it.
   */
  protected async retains(
    run: InspectorRun,
    runs: InspectorRun[],
  ): Promise<boolean> {
    if (run.status === "live") return true;
    if (!run.logFile) return false;

    const replaced = runs.some(
      (other) =>
        other !== run &&
        other.cwd === run.cwd &&
        other.startedAt.localeCompare(run.startedAt) > 0,
    );
    if (replaced) return false;

    return this.fs.exists(run.logFile).catch(() => false);
  }

  /**
   * Whether a run answers: its socket accepts a connection.
   *
   * `refused` is certain: a missing socket fails at once (`ENOENT`), and so
   * does a file nobody listens on (`ECONNREFUSED`). `timeout` is not: it
   * bounds a wedged process, which may yet answer. Not checked through
   * `FileSystemProvider`: a socket is always a real file, whatever backs the
   * entries.
   */
  protected async probe(
    run: InspectorRun,
  ): Promise<"live" | "refused" | "timeout"> {
    return new Promise((resolve) => {
      const socket = createConnection({ path: run.socketPath });
      const done = (result: "live" | "refused" | "timeout") => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(this.connectTimeoutMs, () => done("timeout"));
      socket.once("connect", () => done("live"));
      socket.once("error", () => done("refused"));
    });
  }

  /**
   * The last path segment, whatever the separator: a socket name is meant to
   * be bare, and an entry claiming a path must not point the reader elsewhere.
   */
  protected basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }
}
