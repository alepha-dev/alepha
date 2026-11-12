import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { type Deployment, deployments } from "../entities/deployments.ts";
import { DeployAutomationSources } from "./DeployAutomationSources.ts";

/**
 * One line of a deploy's log.
 */
export interface DeployLogLine {
  at: string;
  text: string;
}

/**
 * Where a deploy's status and log go: straight onto the `deployments` row.
 *
 * ## ⚠️ Nothing here throws
 *
 * By the time most lines are written a Worker has been uploaded and a database
 * migrated. A deploy that failed because its own LOG could not be written would
 * report failure for work that succeeded, and the operator would retry a run
 * that already landed. Every method swallows and logs instead, so a lost line
 * costs a gap in the log and nothing else.
 *
 * ## ⚠️ The log is bounded, and that is not tidiness
 *
 * A deploy that loops, or an adapter that logs per asset, writes a row that
 * grows without limit into a database with a 10 GB ceiling and no sweep job for
 * this table. {@link MAX_LOG_LINES} trims the oldest and leaves a line saying
 * so, because a truncated log that does not say it is truncated reads as a
 * complete one - and the missing lines are exactly the ones somebody is
 * debugging.
 *
 * ## `deploymentId` is optional throughout
 *
 * A deploy driven from a test, or from the CLI against an instance with no row
 * yet, has nothing to write against and must still run. The Worker's own log
 * still gets every line.
 */
export class DeployRegistry {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly rows = $repository(deployments);
  protected readonly automationSources = $inject(DeployAutomationSources);

  /**
   * How many lines one deploy's log keeps.
   *
   * A real deploy writes about a dozen: one per orchestrator step, plus the
   * fetch, the unpack and the outcome. 200 leaves room for an adapter that
   * says more without leaving room for one that never stops.
   */
  public static readonly MAX_LOG_LINES = 200;

  protected forget(deploymentId: string | undefined): void {
    if (deploymentId) {
      this.open.delete(deploymentId);
      this.startedHere.delete(deploymentId);
    }
  }

  /**
   * The runs this process has started, so a second `started` for one is a
   * no-op. Kept apart from the open logs: a line written while a run is still
   * queued (waiting for a slot) opens its log without starting it.
   */
  protected readonly startedHere = new Set<string>();

  /**
   * The run is picked up: status `running`, and a first line saying how long
   * it waited in the queue.
   *
   * ⚠️ The wait is the one cost no step line can show, because every line
   * after this one is timed from `startedAt`. A first deploy of one copy
   * spent 5.6 s there before its first line, which is time a user waits
   * through all the same.
   */
  public async started(deploymentId?: string): Promise<void> {
    // Already started by this process (`DeployService.run` starts the row the
    // moment it takes a slot, then the runner asks again): once is the line.
    if (deploymentId && this.startedHere.has(deploymentId)) {
      return;
    }
    if (deploymentId) {
      this.startedHere.add(deploymentId);
      if (this.startedHere.size > DeployRegistry.MAX_OPEN_LOGS) {
        const oldest = this.startedHere.values().next().value;
        if (oldest !== undefined) this.startedHere.delete(oldest);
      }
    }
    const now = this.dateTime.nowMillis();
    await this.patch(deploymentId, {
      status: "running",
      startedAt: new Date(now).toISOString(),
    });
    if (!deploymentId) {
      return;
    }
    try {
      const row = await this.rows.findById(deploymentId);
      if (row) {
        // Seeds the run's log, so no later line reads the row again.
        this.remember(deploymentId, row.log ?? [], row.startedAt);
      }
      const queuedAt = row?.createdAt ? Date.parse(row.createdAt) : Number.NaN;
      if (Number.isFinite(queuedAt)) {
        await this.line(
          deploymentId,
          `Started after ${this.seconds(now - queuedAt)} queued`,
        );
      }
    } catch (error) {
      this.log.warn("Could not record the queue wait", { error });
    }
  }

  public async succeeded(
    deploymentId: string | undefined,
    outcome: {
      url?: string;
      versionId?: string;
      migrationsApplied?: number;
    } = {},
  ): Promise<boolean> {
    if (outcome.url) {
      await this.line(deploymentId, `Deployed to ${outcome.url}`);
    }
    this.forget(deploymentId);
    return this.patch(deploymentId, {
      status: "succeeded",
      url: outcome.url,
      versionId: outcome.versionId,
      migrationsApplied: outcome.migrationsApplied,
      finishedAt: new Date(this.dateTime.nowMillis()).toISOString(),
    });
  }

  public async failed(
    deploymentId: string | undefined,
    reason?: string,
  ): Promise<boolean> {
    if (reason) {
      await this.line(deploymentId, `Failed: ${reason}`);
    }
    this.forget(deploymentId);
    return this.patch(deploymentId, {
      status: "failed",
      error: reason?.slice(0, 2_000),
      finishedAt: new Date(this.dateTime.nowMillis()).toISOString(),
    });
  }

  public async cancelled(deploymentId?: string): Promise<void> {
    await this.line(deploymentId, "Cancelled");
    this.forget(deploymentId);
    await this.patch(deploymentId, {
      status: "cancelled",
      finishedAt: new Date(this.dateTime.nowMillis()).toISOString(),
    });
  }

  /**
   * One line, appended: one D1 write (#Q3384).
   *
   * ⚠️ **The log is kept in memory for the run, and written whole.** It used
   * to read the row before every line, so a deploy of a dozen lines paid ~24
   * round trips on its critical path. The first line of a run reads the row
   * once (or {@link started} seeds it); every later line appends in memory and
   * writes the bounded log back. Every line is still written as it happens,
   * so a run killed mid-deploy shows how far it got.
   *
   * ⚠️ It needs no lock: a deploy is one job execution writing its own row,
   * and two runs against one instance are two rows. A line some other
   * process appended meanwhile would be overwritten, which is a gap in a log,
   * the failure this method is already allowed to have.
   */
  public async line(
    deploymentId: string | undefined,
    text: string,
  ): Promise<void> {
    this.log.info(text, { deploymentId });
    if (!deploymentId) {
      return;
    }
    try {
      let open = this.open.get(deploymentId);
      if (!open) {
        // Only what the append needs, by primary key (#Q2682).
        const [row] = await this.rows.findMany({
          columns: ["log", "startedAt"],
          where: { id: { eq: deploymentId } },
          limit: 1,
        });
        if (!row) {
          return;
        }
        open = this.remember(deploymentId, row.log ?? [], row.startedAt);
      }
      open.log = this.appended(open.log, this.timed(open.startedAt, text));
      await this.rows.updateById(deploymentId, { log: open.log });
    } catch (error) {
      this.log.warn("Could not record a deploy log line", { error });
    }
  }

  /**
   * The logs of the runs this process is writing, by deployment id. Dropped
   * at the run's terminal state; bounded, so a run that never reaches one
   * (its isolate killed) cannot make it grow.
   */
  protected readonly open = new Map<
    string,
    { log: DeployLogLine[]; startedAt?: string }
  >();

  protected static readonly MAX_OPEN_LOGS = 64;

  protected remember(
    deploymentId: string,
    log: DeployLogLine[],
    startedAt?: string,
  ): { log: DeployLogLine[]; startedAt?: string } {
    if (this.open.size >= DeployRegistry.MAX_OPEN_LOGS) {
      const oldest = this.open.keys().next().value;
      if (oldest !== undefined) this.open.delete(oldest);
    }
    const entry = { log, startedAt };
    this.open.set(deploymentId, entry);
    return entry;
  }

  /**
   * The line as the reader sees it: `+12.3s ` in front, the time since the run
   * started.
   *
   * ## ⚠️ In the TEXT, although every line already carries `at`
   *
   * Nothing a person reads shows `at`: the Deploy tab joins the texts, and the
   * MCP `deploy_status` tool answers texts only. A step is logged when it
   * STARTS, so the gap between two prefixes is what the first one cost, and
   * the costs are readable straight off the log a user already has open.
   *
   * Left bare for a row that never started, which is only ever a line written
   * outside a run.
   */
  protected timed(startedAt: string | undefined, text: string): string {
    const started = startedAt ? Date.parse(startedAt) : Number.NaN;
    if (!Number.isFinite(started)) {
      return text;
    }
    return `+${this.seconds(this.dateTime.nowMillis() - started)} ${text}`;
  }

  /**
   * Milliseconds as seconds with one decimal, never negative: two clocks that
   * disagree by a few milliseconds must not print `+-0.0s`.
   */
  protected seconds(millis: number): string {
    return `${(Math.max(0, millis) / 1000).toFixed(1)}s`;
  }

  /**
   * The log with one line added, trimmed if that took it over the bound.
   */
  protected appended(existing: DeployLogLine[], text: string): DeployLogLine[] {
    const at = new Date(this.dateTime.nowMillis()).toISOString();
    const next = [...existing, { at, text: text.slice(0, 500) }];
    if (next.length <= DeployRegistry.MAX_LOG_LINES) {
      return next;
    }
    // The oldest go, and the reader is told. A log that silently lost its
    // first half looks like a deploy that started in the middle.
    const dropped = next.length - DeployRegistry.MAX_LOG_LINES;
    return [
      { at, text: `... ${dropped} earlier line(s) dropped` },
      ...next.slice(dropped + 1),
    ];
  }

  protected async patch(
    deploymentId: string | undefined,
    values: Partial<Deployment>,
  ): Promise<boolean> {
    if (!deploymentId) return false;
    try {
      if (values.status === "succeeded" || values.status === "failed")
        return await this.automationSources.terminal(deploymentId, values);
      await this.rows.updateById(deploymentId, values);
      return true;
    } catch (error) {
      this.log.warn(
        "Could not record a deploy status and its automation event",
        { deploymentId, requestedStatus: values.status, error },
      );
      return false;
    }
  }
}
