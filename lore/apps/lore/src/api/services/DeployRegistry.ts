import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

/**
 * One line of a deploy's log.
 */
export interface DeployLogLine {
  at: string;
  text: string;
}

/**
 * Where a deploy's status and log go.
 *
 * ## ⚠️ A seam, and the table behind it is #1201's
 *
 * The runner has to be able to say what it is doing before there is anywhere
 * to write it, or the two land in one commit and neither can be tested without
 * the other. So this is the interface the runner drives, with a buffer behind
 * it today; #1201 adds the `deployments` table and the D1-backed
 * implementation, and substitutes it the way every other provider in this
 * codebase is substituted.
 *
 * ⚠️ **Nothing here throws.** A deploy that fails because its own log could
 * not be written is a worse outcome than a deploy with a gap in its log: the
 * side effects - a Worker uploaded, a database migrated - have already
 * happened by the time most lines are written, so a throw here would report
 * failure for work that succeeded. Every method swallows and logs instead.
 *
 * ⚠️ `deploymentId` is optional throughout, and that is not laziness. A deploy
 * driven from a test, or from the CLI before #1201's row exists, has no row to
 * write against and must still run.
 */
export class DeployRegistry {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The log lines this process has buffered, by deployment id.
   *
   * In-memory, so it is lost when the isolate is recycled. That is exactly why
   * #1201 replaces it: a deploy the user is watching outlives the isolate that
   * started it.
   */
  protected readonly lines = new Map<string, DeployLogLine[]>();

  /**
   * The status each deployment last reported.
   */
  protected readonly status = new Map<string, string>();

  public async started(deploymentId?: string): Promise<void> {
    await this.record(deploymentId, "running");
  }

  public async succeeded(deploymentId?: string, url?: string): Promise<void> {
    await this.record(deploymentId, "succeeded");
    if (url) {
      await this.write(deploymentId, `Deployed to ${url}`);
    }
  }

  public async failed(deploymentId?: string, reason?: string): Promise<void> {
    await this.record(deploymentId, "failed");
    if (reason) {
      await this.write(deploymentId, `Failed: ${reason}`);
    }
  }

  /**
   * One line, timestamped through `DateTimeProvider` so a test can pin it.
   */
  public async line(
    deploymentId: string | undefined,
    text: string,
  ): Promise<void> {
    await this.write(deploymentId, text);
  }

  public linesOf(deploymentId: string): DeployLogLine[] {
    return this.lines.get(deploymentId) ?? [];
  }

  public statusOf(deploymentId: string): string | undefined {
    return this.status.get(deploymentId);
  }

  protected async write(
    deploymentId: string | undefined,
    text: string,
  ): Promise<void> {
    // Logged whether or not there is a row: a deploy driven with no
    // `deploymentId` still has to be followable in the Worker's own log.
    this.log.info(text, { deploymentId });
    if (!deploymentId) {
      return;
    }
    try {
      const lines = this.lines.get(deploymentId) ?? [];
      lines.push({
        at: new Date(this.dateTime.nowMillis()).toISOString(),
        text,
      });
      this.lines.set(deploymentId, lines);
    } catch (error) {
      this.log.warn("Could not record a deploy log line", { error });
    }
  }

  protected async record(
    deploymentId: string | undefined,
    status: string,
  ): Promise<void> {
    if (!deploymentId) {
      return;
    }
    try {
      this.status.set(deploymentId, status);
    } catch (error) {
      this.log.warn("Could not record a deploy status", { error });
    }
  }
}
