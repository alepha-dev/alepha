import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import {
  type AgentAutomation,
  agentAutomations,
} from "../entities/agentAutomations.ts";
import { projects } from "../entities/projects.ts";
import type { HostJobSummary } from "./HostJobs.ts";
import { SourceRepository } from "./SourceRepository.ts";

/**
 * An automation stops itself when its runs keep failing (#Q4230): it runs
 * unattended, on someone's paid subscription and with their `gh` login.
 *
 * - A failed or timed-out job counts one more failure in a row, recorded
 *   with `automation.run.failed`; a success resets the count. A usage
 *   limit fails a job too (#E171 dropped the pause), so this is also what
 *   stops an automation that keeps hitting one.
 * - The third in a row sets `enabled: false`, with `automation.disabled`
 *   naming the last job and its reason.
 * - A cancelled job counts neither way, nor does a run that never started
 *   (a host offline, a ceiling): those are skips.
 */
export class AgentAutomationHealth {
  /**
   * Failures in a row that disable an automation.
   */
  public static readonly FAILURES = 3;

  protected readonly log = $logger();
  protected readonly rows = $repository(agentAutomations);
  protected readonly projects = $repository(projects);
  protected readonly events = $inject(SourceRepository.of(agentAutomations));

  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (!job.automationId) return;
      const automation = await this.rows.findOne({
        where: { id: { eq: job.automationId } },
      });
      if (!automation) return;
      if (job.status === "succeeded") {
        if (automation.consecutiveFailures > 0) {
          await this.rows.updateById(automation.id, {
            consecutiveFailures: 0,
          });
        }
        return;
      }
      if (job.status !== "failed" && job.status !== "timed_out") return;
      await this.failed(automation, job).catch((error) =>
        this.log.warn("An automation's failure could not be recorded", {
          automation: automation.id,
          error,
        }),
      );
    },
  });

  protected async failed(
    automation: AgentAutomation,
    job: HostJobSummary,
  ): Promise<void> {
    const failures = automation.consecutiveFailures + 1;
    const disable =
      automation.enabled && failures >= AgentAutomationHealth.FAILURES;
    const reason =
      job.reason ??
      (job.status === "timed_out" ? "The job timed out" : "The job failed");
    const project = await this.projects.findOne({
      where: { id: { eq: automation.projectId } },
    });
    const fields = {
      project: project?.title,
      title: automation.name,
      automation_id: automation.id,
      automation: automation.name,
      job_id: job.id,
      reason: reason.slice(0, 500),
    };
    // The count moves from the value read, so two endings racing count
    // once each rather than overwrite each other. The failure itself is
    // `agent.job.failed`, raised for every agent job (#Q4276).
    await this.rows.updateMany(
      {
        id: { eq: automation.id },
        consecutiveFailures: { eq: automation.consecutiveFailures },
      },
      { consecutiveFailures: failures },
    );
    if (!disable) return;
    await this.events.sourceUpdate(
      { id: automation.id, enabled: true },
      {
        enabled: false,
        lastSkippedAt: job.endedAt ?? job.queuedAt,
        lastSkippedReason:
          `Disabled after ${failures} failed runs in a row: ${reason}`.slice(
            0,
            500,
          ),
      },
      {
        projectId: automation.projectId,
        name: "automation.disabled",
        subjectId: automation.id,
        fields,
      },
    );
  }
}
