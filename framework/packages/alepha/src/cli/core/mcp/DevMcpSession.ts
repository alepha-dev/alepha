import { sep } from "node:path";

import { $inject, AlephaError } from "alepha";
import {
  InspectorClient,
  type InspectorConnection,
  type InspectorRun,
} from "alepha/inspector";

/**
 * What a tool gets when it asks for the selected app: a connection, or the
 * sentence to answer with instead.
 */
export type DevMcpTarget =
  | { connection: InspectorConnection; answer?: undefined }
  | { connection?: undefined; answer: string };

/**
 * The state of one `alepha mcp` server: which running app the agent works on.
 *
 * It reaches apps only through {@link InspectorClient}, which is side-effect
 * free: the server never registers the inspector itself, so it never lists
 * itself among the apps.
 *
 * **Selection** (#E118, decision 2): an app chosen with `app_select` wins;
 * else, among the live runs, the one whose `cwd` or `gitRoot` contains the
 * server's working directory (the deepest `cwd` when several do); else the
 * only live run; else, when nothing runs, the dead run whose `cwd` contains
 * it, for its logs; else none. A choice is kept by `cwd`, never by run id: under
 * `alepha dev` every reload writes a new entry under a new run id, and the
 * choice follows it.
 */
export class DevMcpSession {
  protected readonly client = $inject(InspectorClient);

  /**
   * The server's working directory, which the automatic selection matches
   * against. The command sets it before starting the server.
   */
  public root = "";

  /**
   * The `cwd` of the app chosen with `app_select`, when one was.
   */
  protected chosen?: string;

  /**
   * Every run the registry lists: the live ones, and the last dead run of
   * each app while its log file remains.
   */
  public runs(): Promise<InspectorRun[]> {
    return this.client.discover();
  }

  /**
   * Pick an app by name, `cwd` or run id, and keep it by `cwd`.
   *
   * @returns the run picked, or the sentence explaining why none was.
   */
  public async select(
    query: string,
  ): Promise<{ run: InspectorRun } | { answer: string }> {
    const runs = await this.runs();
    if (!runs.length) {
      return { answer: this.noApp() };
    }

    const matches = runs.filter(
      (run) => run.runId === query || run.cwd === query || run.name === query,
    );
    const cwds = [...new Set(matches.map((run) => run.cwd))];
    if (cwds.length > 1) {
      return {
        answer: `"${query}" names ${cwds.length} apps (${cwds.join(", ")}): select one by its cwd.`,
      };
    }
    if (!cwds.length) {
      return {
        answer: `No app matches "${query}". Running: ${runs
          .map((run) => `${run.name} (${run.cwd})`)
          .join(", ")}.`,
      };
    }

    this.chosen = cwds[0];
    return { run: this.pick(runs, cwds[0]) as InspectorRun };
  }

  /**
   * The run the tools act on, by the selection rule, or `undefined`.
   */
  public async selected(): Promise<InspectorRun | undefined> {
    const runs = await this.runs();
    if (this.chosen) {
      return this.pick(runs, this.chosen);
    }

    const live = runs.filter((run) => run.status === "live");
    const containing = live
      .filter(
        (run) =>
          this.contains(run.cwd, this.root) ||
          (!!run.gitRoot && this.contains(run.gitRoot, this.root)),
      )
      .sort(
        (a, b) =>
          Number(this.contains(b.cwd, this.root)) -
            Number(this.contains(a.cwd, this.root)) ||
          b.cwd.length - a.cwd.length ||
          b.startedAt.localeCompare(a.startedAt),
      );
    if (containing.length) {
      return containing[0];
    }

    const apps = [...new Set(live.map((run) => run.cwd))];
    if (apps.length === 1) {
      return this.pick(live, apps[0]);
    }

    // No live run to act on: the dead run of the app this server works in,
    // so the logs of a crash stay readable without an app_select.
    if (!live.length) {
      return runs
        .filter((run) => this.contains(run.cwd, this.root))
        .sort(
          (a, b) =>
            b.cwd.length - a.cwd.length ||
            b.startedAt.localeCompare(a.startedAt),
        )[0];
    }
    return undefined;
  }

  /**
   * A connection to the selected run for a tool that only reads logs, which
   * a dead run still has; or the sentence to answer with.
   */
  public async logTarget(): Promise<DevMcpTarget> {
    const run = await this.selected();
    if (!run) {
      return { answer: await this.noSelection() };
    }
    return this.connect(run);
  }

  /**
   * A connection to the selected run for a tool that calls its routes, which
   * needs it live; or the sentence to answer with.
   */
  public async target(): Promise<DevMcpTarget> {
    const run = await this.selected();
    if (!run) {
      return { answer: await this.noSelection() };
    }
    if (run.status === "dead") {
      return {
        answer: `The selected app, ${run.name} (${run.cwd}), is not running: its last run (${run.runId}) is dead, and only its logs are readable (logs_tail). Start it again with \`alepha dev\`.`,
      };
    }
    return this.connect(run);
  }

  /**
   * The answer when no app runs at all.
   */
  public noApp(): string {
    return "No Alepha app is running on this machine. Start one with `alepha dev` in its project, then call apps_list. For the map of an app that is not running, run `alepha docs --app` in its project.";
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected connect(run: InspectorRun): DevMcpTarget {
    try {
      return { connection: this.client.connect(run) };
    } catch (error) {
      // A run speaking another protocol version: the client's own message
      // names both and the release that matches.
      if (error instanceof AlephaError) {
        return { answer: error.message };
      }
      throw error;
    }
  }

  protected async noSelection(): Promise<string> {
    const runs = await this.runs();
    if (this.chosen) {
      return `The selected app (${this.chosen}) is not running any more. Start it again with \`alepha dev\`, or call app_select for another one.`;
    }
    if (!runs.some((run) => run.status === "live")) {
      return this.noApp();
    }
    return `Several apps are running and none contains ${this.root}: call apps_list, then app_select one.`;
  }

  /**
   * The run of the app at `cwd`: its newest live run, else its dead one.
   */
  protected pick(runs: InspectorRun[], cwd: string): InspectorRun | undefined {
    const own = runs
      .filter((run) => run.cwd === cwd)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return own.find((run) => run.status === "live") ?? own[0];
  }

  /**
   * Whether `path` is `dir` or inside it.
   */
  protected contains(dir: string, path: string): boolean {
    if (!dir || !path) return false;
    const base = dir.endsWith(sep) ? dir : `${dir}${sep}`;
    return path === dir || path.startsWith(base);
  }
}
