import { createConnection } from "node:net";
import { homedir } from "node:os";

import { $env, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
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
   * Every run that answers, oldest first.
   *
   * Alive means its socket accepts a connection. Not the pid: a container's
   * pid means nothing on the host (every container's main process is pid 1),
   * and a pid can be reused by an unrelated process. The connect covers both.
   * A file that does not parse as an entry is skipped rather than fatal: a
   * reader can catch a writer mid-write, and one torn file must not hide the
   * other apps.
   */
  public async discover(): Promise<InspectorRun[]> {
    const runs = await this.list();
    const alive = await Promise.all(runs.map((run) => this.isAlive(run)));
    return runs.filter((_, index) => alive[index]);
  }

  /**
   * Every entry in the run directory, alive or not.
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
      runs.push({
        ...entry,
        file,
        // The writer's own absolute path means nothing here when the writer
        // was a container: only the name is trusted, against this directory.
        socketPath: this.fs.join(dir, this.basename(entry.socket)),
      });
    }

    return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
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
   * Whether a run answers: its socket accepts a connection.
   *
   * A missing socket fails at once (`ENOENT`), and so does a file nobody
   * listens on (`ECONNREFUSED`), so the timeout only bounds a process that is
   * wedged. Not checked through `FileSystemProvider`: a socket is always a
   * real file, whatever backs the entries.
   */
  protected async isAlive(run: InspectorRun): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ path: run.socketPath });
      const done = (alive: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(alive);
      };
      socket.setTimeout(this.connectTimeoutMs, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
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
