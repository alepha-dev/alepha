import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { INSPECTOR_PROTOCOL } from "../constants/INSPECTOR_PROTOCOL.ts";
import type { InspectorRunEntry } from "../schemas/InspectorRunEntry.ts";
import { InspectorRegistry } from "../services/InspectorRegistry.ts";
import { DevLogStoreProvider } from "./DevLogStoreProvider.ts";
import { InspectorSocketServer } from "./InspectorSocketServer.ts";

/**
 * The run registry, write side: announces this process in
 * `<runDir>/<runId>.json` once it is ready, and withdraws it on stop.
 *
 * Under `alepha dev` the app is an Alepha instance inside the Vite process,
 * recreated on every reload: the entry is removed and rewritten under a new
 * run id within milliseconds. A tool keeps its selection across that by
 * matching `cwd`.
 */
export class InspectorRunProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly registry = $inject(InspectorRegistry);
  protected readonly logStore = $inject(DevLogStoreProvider);

  /**
   * 8 random base36 characters. Short on purpose: it also names the socket,
   * and `~/.alepha/run/<runId>.sock` must stay far under the 104-byte limit
   * macOS puts on a socket path.
   */
  public readonly runId = this.generateRunId();

  /**
   * The entry file this process wrote, once it has.
   */
  public file?: string;

  /**
   * Written on `ready`, not `start`: the entry tells a tool it can connect,
   * so it must not appear before the socket (opened on `start`) answers.
   */
  protected readonly onReady = $hook({
    on: "ready",
    handler: async () => {
      await this.register();
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.unregister();
    },
  });

  /**
   * The entry this process announces.
   */
  public async entry(): Promise<InspectorRunEntry> {
    const cwd = process.cwd();
    return {
      runId: this.runId,
      name: await this.resolveName(cwd),
      cwd,
      gitRoot: await this.resolveGitRoot(cwd),
      pid: process.pid,
      mode: this.alepha.isProduction() ? "production" : "development",
      alephaVersion: this.alepha.meta.framework || "unknown",
      protocol: INSPECTOR_PROTOCOL,
      startedAt: this.dateTime.nowISOString(),
      socket: `${this.runId}.sock`,
      logFile: this.logStore.path,
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected async register(): Promise<void> {
    // Resolved here rather than injected: the socket server needs this
    // provider's run id, and a field injection both ways is a cycle.
    if (!this.alepha.inject(InspectorSocketServer).listening) {
      // No socket (Windows, a path too long, a refused bind): an entry
      // would announce a process nobody can reach.
      return;
    }

    const dir = this.registry.directory();
    const file = this.fs.join(dir, `${this.runId}.json`);

    try {
      // `0700` on the directory and `0600` on the entry: what is inside is a
      // way into a process that serves its secrets, for its owner only.
      await this.fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await this.fs.writeFile(file, JSON.stringify(await this.entry()), {
        mode: 0o600,
      });
      this.file = file;
      this.log.debug("Inspector run registered", { file });
    } catch (error) {
      // A read-only home or a sandbox costs discoverability, never the boot.
      this.log.warn("Could not write the inspector run entry", {
        file,
        error,
      });
    }
  }

  protected async unregister(): Promise<void> {
    if (!this.file) return;
    const file = this.file;
    this.file = undefined;
    try {
      await this.fs.rm(file, { force: true });
    } catch (error) {
      this.log.debug("Could not remove the inspector run entry", {
        file,
        error,
      });
    }
  }

  protected generateRunId(): string {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(
      "",
    );
  }

  /**
   * The `name` of the nearest `package.json` at or above `cwd`, else the
   * basename of `cwd`.
   */
  protected async resolveName(cwd: string): Promise<string> {
    for (const dir of this.ancestors(cwd)) {
      const pkg = this.fs.join(dir, "package.json");
      try {
        if (!(await this.fs.exists(pkg))) continue;
        const json = await this.fs.readJsonFile<{ name?: unknown }>(pkg);
        if (typeof json.name === "string" && json.name) return json.name;
        // A package.json without a name (a workspace root, say) is still the
        // nearest one: fall back rather than walk on into an unrelated parent.
        break;
      } catch {
        break;
      }
    }
    return this.ancestors(cwd)[0]?.split(/[\\/]/).pop() || cwd;
  }

  /**
   * The nearest directory at or above `cwd` holding `.git`, a directory in a
   * main checkout and a file in a worktree.
   */
  protected async resolveGitRoot(cwd: string): Promise<string | undefined> {
    for (const dir of this.ancestors(cwd)) {
      if (await this.fs.exists(this.fs.join(dir, ".git"))) return dir;
    }
    return undefined;
  }

  /**
   * `cwd`, then each parent up to the filesystem root.
   */
  protected ancestors(cwd: string): string[] {
    const dirs: string[] = [];
    let dir = this.fs.resolve(cwd);
    while (true) {
      dirs.push(dir);
      const parent = this.fs.resolve(dir, "..");
      if (parent === dir) return dirs;
      dir = parent;
    }
  }
}
