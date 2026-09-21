import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { type Deployment, deployments } from "../entities/deployments.ts";

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

  /**
   * How many lines one deploy's log keeps.
   *
   * A real deploy writes about a dozen: one per orchestrator step, plus the
   * fetch, the unpack and the outcome. 200 leaves room for an adapter that
   * says more without leaving room for one that never stops.
   */
  public static readonly MAX_LOG_LINES = 200;

  /**
   * The run is picked up: status `running`, and a first line saying how long
   * it waited in the queue.
   *
   * ⚠️ The wait is the one cost no step line can show, because every line
   * after this one is timed from `startedAt`. A first deploy of a club copy
   * spent 5.6 s there before its first line, which is time a user waits
   * through all the same.
   */
  public async started(deploymentId?: string): Promise<void> {
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
    outcome: { url?: string; versionId?: string } = {},
  ): Promise<void> {
    if (outcome.url) {
      await this.line(deploymentId, `Deployed to ${outcome.url}`);
    }
    await this.patch(deploymentId, {
      status: "succeeded",
      url: outcome.url,
      versionId: outcome.versionId,
      finishedAt: new Date(this.dateTime.nowMillis()).toISOString(),
    });
  }

  public async failed(
    deploymentId: string | undefined,
    reason?: string,
  ): Promise<void> {
    if (reason) {
      await this.line(deploymentId, `Failed: ${reason}`);
    }
    await this.patch(deploymentId, {
      status: "failed",
      error: reason?.slice(0, 2_000),
      finishedAt: new Date(this.dateTime.nowMillis()).toISOString(),
    });
  }

  public async cancelled(deploymentId?: string): Promise<void> {
    await this.line(deploymentId, "Cancelled");
    await this.patch(deploymentId, {
      status: "cancelled",
      finishedAt: new Date(this.dateTime.nowMillis()).toISOString(),
    });
  }

  /**
   * One line, appended.
   *
   * ⚠️ Read-modify-write, and it does not need a lock: a deploy is one job
   * execution writing its own row, and two runs against one instance are two
   * rows. A lost line under a race would be a gap in a log, which is the
   * failure this method is already allowed to have.
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
      const row = await this.rows.findById(deploymentId);
      if (!row) {
        return;
      }
      await this.rows.updateById(deploymentId, {
        log: this.appended(row.log ?? [], this.timed(row.startedAt, text)),
      });
    } catch (error) {
      this.log.warn("Could not record a deploy log line", { error });
    }
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
  ): Promise<void> {
    if (!deploymentId) {
      return;
    }
    try {
      await this.rows.updateById(deploymentId, values as never);
    } catch (error) {
      this.log.warn("Could not record a deploy status", { error });
    }
  }
}
