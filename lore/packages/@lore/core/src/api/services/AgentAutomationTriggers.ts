import { $hook, $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import {
  type AgentAutomation,
  agentAutomations,
} from "../entities/agentAutomations.ts";
import type { ProjectEvent } from "../entities/projectEvents.ts";
import { AgentAutomationService } from "./AgentAutomationService.ts";
import { HostJobs } from "./HostJobs.ts";
import { ProjectEventListeners } from "./ProjectEventListeners.ts";

/**
 * The event trigger of an agent automation (#Q4227): the automation service
 * is a second consumer of project events, beside the subscriptions, which
 * stay "who is told" (decided by the review of #E172).
 *
 * - **Listening**: an enabled automation on `trigger: event` names catalog
 *   keys. Its project's events of those names get a delivery job even with
 *   no subscriber, and the job hands each one here.
 * - **Never its own**: an event raised by one of the automation's own jobs
 *   (`project_events.jobId`) never triggers it.
 * - **Coalesced**: the first event sets `pending` and pushes one delayed
 *   settle job (`settleSeconds`, 60 by default), so a burst lands in one
 *   prompt. An event while `pending` is set starts nothing more. When the
 *   settle job finds the automation's job still queued or running, `pending`
 *   waits for that job to end (`host:job:ended`), which starts the one
 *   follow-up run. Ten feedback items in a minute are two runs, not ten.
 * - **Attribution**: the run is its owner's (`createdBy`), whose rank bounds
 *   the job key, never whoever caused the event; the event's job, when a job
 *   raised it, becomes the run's parent (`startedByJobId`), which the chain
 *   guard reads.
 */
export class AgentAutomationTriggers {
  protected readonly log = $logger();
  protected readonly rows = $repository(agentAutomations);
  protected readonly service = $inject(AgentAutomationService);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly listeners = $inject(ProjectEventListeners);

  constructor() {
    this.listeners.register({
      name: "automations",
      listens: async (projectId, event) =>
        (await this.listening(projectId, event)).length > 0,
      receive: (event) => this.receive(event),
    });
  }

  /**
   * The run an event, or a job's end, asked for: after the settle delay, or
   * at once for a follow-up.
   */
  public readonly settle = $job({
    name: "agent-automations.settle",
    description:
      "Starts the run an agent automation's events asked for, once they settled.",
    schema: z.object({ automationId: z.uuid() }),
    retention: { ok: { days: 2 }, error: { days: 14 } },
    handler: async ({ payload }) => {
      await this.start(payload.automationId);
    },
  });

  /**
   * The project's enabled automations listening to an event.
   */
  public async listening(
    projectId: number,
    event: string,
  ): Promise<AgentAutomation[]> {
    const rows = await this.rows.findMany({
      where: {
        projectId: { eq: projectId },
        enabled: { eq: true },
        trigger: { eq: "event" },
      },
    });
    return rows.filter((row) => row.eventKeys?.includes(event));
  }

  /**
   * One event, for every automation of its project that listens to it.
   */
  public async receive(event: ProjectEvent): Promise<void> {
    const automations = await this.listening(event.projectId, event.name);
    if (!automations.length) return;
    const raisedBy = event.jobId
      ? await this.hostJobs.get(event.jobId)
      : undefined;
    for (const automation of automations) {
      // What its own jobs wrote never triggers it again.
      if (raisedBy?.automationId === automation.id) continue;
      await this.ask(automation, event);
    }
  }

  /**
   * Marks the automation pending, and pushes its settle job when this event
   * is the first of a burst.
   */
  protected async ask(
    automation: AgentAutomation,
    event: ProjectEvent,
  ): Promise<void> {
    const claimed = await this.rows.updateMany(
      { id: { eq: automation.id }, pending: { eq: false } },
      {
        pending: true,
        ...(event.jobId ? { pendingJobId: event.jobId } : {}),
      },
    );
    if (this.count(claimed) === 0) {
      // Already pending: this event joins the run already asked for. A job
      // among the burst's causes is kept as its parent, the strictest.
      if (event.jobId) {
        await this.rows.updateMany(
          {
            id: { eq: automation.id },
            pending: { eq: true },
            pendingJobId: { isNull: true },
          },
          { pendingJobId: event.jobId },
        );
      }
      return;
    }
    await this.settle.push(
      { automationId: automation.id },
      {
        key: `${automation.id}:${event.id}`,
        ...(automation.settleSeconds > 0
          ? {
              delay: [automation.settleSeconds, "seconds"] as [
                number,
                "seconds",
              ],
            }
          : {}),
      },
    );
  }

  /**
   * Starts the pending run, unless the automation's job is still queued or
   * running: then the job's end starts it.
   */
  public async start(automationId: string): Promise<void> {
    const automation = await this.rows.findOne({
      where: { id: { eq: automationId } },
    });
    if (!automation?.pending) return;
    if (!automation.enabled || automation.trigger !== "event") {
      await this.clear(automation.id);
      return;
    }
    const active = await this.hostJobs.activeForAutomation(automation.id);
    if (active.length >= this.service.concurrencyOf(automation)) return;
    if (!(await this.clear(automation.id))) return;
    const outcome = await this.service.runTriggered(
      automation,
      automation.pendingJobId ?? undefined,
    );
    if (outcome.skipped) {
      this.log.info("An agent automation's event run started nothing", {
        automation: automation.id,
        reason: outcome.skipped,
      });
    }
  }

  /**
   * An automation's job ended: the run its pending events asked for starts
   * now, as one follow-up.
   */
  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (!job.automationId) return;
      const automation = await this.rows.findOne({
        where: { id: { eq: job.automationId } },
      });
      if (!automation?.pending) return;
      await this.settle.push(
        { automationId: automation.id },
        { key: `${automation.id}:after:${job.id}` },
      );
    },
  });

  /**
   * Clears `pending`, answering whether this call did: a second settle job
   * racing this one finds it cleared and starts nothing.
   */
  protected async clear(automationId: string): Promise<boolean> {
    const cleared = await this.rows.updateMany(
      { id: { eq: automationId }, pending: { eq: true } },
      { pending: false, pendingJobId: null as never },
    );
    return this.count(cleared) > 0;
  }

  protected count(result: unknown): number {
    if (Array.isArray(result)) return result.length;
    return result ? 1 : 0;
  }
}
