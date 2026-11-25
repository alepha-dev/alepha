import { AgentJobs, HostJobs } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { type Quest, quests } from "../entities/quests.ts";

/**
 * A quest an agent works (#Q3989): an **untrusted** quest (born of feedback
 * written outside the team) waits for a member to confirm its text, recorded
 * with who and when, and a quest's work time. The job itself is the
 * `work-quest` prompt's run (#Q4275).
 */
export class QuestAgentService {
  /**
   * A quest's work time.
   */
  public static readonly WORK_SECONDS = 60 * 60;

  protected readonly alepha = $inject(Alepha);
  protected readonly rows = $repository(quests);
  protected readonly projects = $repository(projects);
  protected readonly agents = $inject(AgentJobs);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * A member confirms an untrusted quest's text: an agent may then work it.
   * Recorded once, with who and when.
   */
  public async confirm(
    projectId: number,
    shortId: number,
    userId: string,
  ): Promise<Quest> {
    const quest = await this.find(projectId, shortId);
    if (!quest.untrusted) {
      throw new BadRequestError(`Quest ${shortId} needs no confirmation`);
    }
    if (!quest.untrustedConfirmedAt) {
      await this.rows.updateById(quest.id, {
        untrustedConfirmedAt: new Date(this.dateTime.nowMillis()).toISOString(),
        untrustedConfirmedBy: userId,
      });
    }
    return this.find(projectId, shortId);
  }

  protected async find(projectId: number, shortId: number): Promise<Quest> {
    const quest = await this.rows.findOne({
      where: { projectId: { eq: projectId }, shortId: { eq: shortId } },
    });
    if (!quest) {
      throw new NotFoundError(`No quest ${shortId} in this project`);
    }
    return quest;
  }
}
