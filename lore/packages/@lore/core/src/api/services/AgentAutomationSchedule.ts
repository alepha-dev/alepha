import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { agentAutomations } from "../entities/agentAutomations.ts";
import { AgentAutomationService } from "./AgentAutomationService.ts";
import { HourlyChecks } from "./HourlyChecks.ts";

/**
 * The schedule trigger of an agent automation (#Q4228): a check of the
 * hourly job #E159 kept (`project-events.hourly`), beside the quest
 * reminders and the errors threshold. No scheduler of its own.
 *
 * - **One indexed query** on `nextRunAt <= now` across every project, at
 *   most {@link LIMIT} per tick, never a loop over projects.
 * - **Claimed once.** `nextRunAt` moves to the next run after this tick by a
 *   write whose condition is the value the tick read: a second tick finds it
 *   moved and runs nothing. A tick missed while the host or Lore was down is
 *   not replayed: the next tick decides again, and `nextRunAt` moves forward
 *   whether the run started or was skipped.
 * - The run is its owner's, through `runTriggered`: the "only if there is
 *   something" check, and the skip recorded on the row.
 */
export class AgentAutomationSchedule {
  public static readonly LIMIT = 100;

  protected readonly log = $logger();
  protected readonly checks = $inject(HourlyChecks);
  protected readonly rows = $repository(agentAutomations);
  protected readonly service = $inject(AgentAutomationService);
  protected readonly dateTime = $inject(DateTimeProvider);

  constructor() {
    this.checks.register({
      name: "automations.schedule",
      run: async (now) => {
        await this.run(now);
      },
    });
  }

  /**
   * Runs every scheduled automation due at `now`. Answers how many it
   * started a run for.
   */
  public async run(now: string): Promise<number> {
    const due = await this.rows.findMany({
      where: { nextRunAt: { lte: now } },
      orderBy: [{ column: "nextRunAt", direction: "asc" }],
      limit: AgentAutomationSchedule.LIMIT,
    });
    let started = 0;
    for (const automation of due) {
      if (automation.trigger !== "schedule" || !automation.enabled) continue;
      const next = this.service.nextRunAfter(
        automation,
        new Date(now).getTime(),
      );
      const claimed = await this.rows.updateMany(
        {
          id: { eq: automation.id },
          nextRunAt: { eq: automation.nextRunAt as string },
        },
        { nextRunAt: next },
      );
      if (Array.isArray(claimed) ? claimed.length === 0 : !claimed) continue;
      const outcome = await this.service.runTriggered(automation);
      if (outcome.jobIds.length) started++;
    }
    return started;
  }
}
