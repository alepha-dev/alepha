import { $hook, $inject } from "alepha";
import { DateTimeProvider, type Interval } from "alepha/datetime";
import type { InspectorRun } from "alepha/inspector";
import { $logger } from "alepha/logger";

import type { MigrationDrift } from "../schemas/migrationDriftSchema.ts";
import type { WorktreeState } from "../schemas/worktreeStateSchema.ts";
import { GitService } from "../services/GitService.ts";

/**
 * Git state for the apps the devtools shows, kept warm in the background.
 *
 * Refreshed when the set of runs changes and on a slow interval, never per
 * request: the UI polls the run list every two seconds, and a handful of
 * `git` processes per poll per worktree would be felt on a laptop with ten
 * worktrees open. Requests read whatever the last refresh found.
 */
export class GitStateProvider {
  protected readonly log = $logger();
  protected readonly git = $inject(GitService);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly refreshSeconds = 15;

  protected worktrees = new Map<string, WorktreeState>();
  protected drift = new Map<string, MigrationDrift>();
  protected roots = new Set<string>();
  protected cwds = new Set<string>();
  protected refreshing?: Promise<void>;
  protected interval?: Interval;

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.interval = this.dateTime.createInterval(
        () => void this.refresh(),
        [this.refreshSeconds, "seconds"],
      );
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => {
      if (this.interval) this.dateTime.clearInterval(this.interval);
      this.interval = undefined;
    },
  });

  /**
   * Note the runs being shown; a new worktree or app schedules a refresh.
   */
  public observe(runs: InspectorRun[]): void {
    const roots = new Set(
      runs.map((run) => run.gitRoot).filter((root): root is string => !!root),
    );
    const cwds = new Set(
      runs.filter((run) => !!run.gitRoot).map((run) => run.cwd),
    );
    const changed =
      [...roots].some((root) => !this.roots.has(root)) ||
      [...cwds].some((cwd) => !this.cwds.has(cwd)) ||
      roots.size !== this.roots.size ||
      cwds.size !== this.cwds.size;

    if (changed) {
      this.roots = roots;
      this.cwds = cwds;
      void this.refresh();
    }
  }

  /**
   * The last known state of every observed worktree, by its root.
   */
  public snapshot(): Record<string, WorktreeState> {
    return Object.fromEntries(this.worktrees);
  }

  /**
   * The last known migration drift of an app, by its directory.
   */
  public driftOf(cwd: string): MigrationDrift | undefined {
    return this.drift.get(cwd);
  }

  /**
   * Read everything again. One refresh at a time: a call during one waits
   * for it rather than starting a second.
   */
  public refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  protected async load(): Promise<void> {
    try {
      const worktrees = new Map<string, WorktreeState>();
      for (const root of this.roots) {
        const state = await this.git.worktree(root);
        if (state) worktrees.set(root, state);
      }
      const drift = new Map<string, MigrationDrift>();
      for (const cwd of this.cwds) {
        drift.set(cwd, await this.git.migrations(cwd));
      }
      this.worktrees = worktrees;
      this.drift = drift;
    } catch (error) {
      this.log.debug("Could not refresh the git state", { error });
    }
  }
}
