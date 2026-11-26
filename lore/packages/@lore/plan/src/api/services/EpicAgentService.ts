import { AgentJobs, HostJobs, JobKeyService } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { type Epic, epics } from "../entities/epics.ts";
import { quests } from "../entities/quests.ts";

/**
 * Review with an agent (#Q4214): an epic's Review prompt run as an agent job
 * on the project's Agent host, instead of being pasted into a session.
 *
 * Its key is pinned to the epic (`job_keys.epic_number`, checked by
 * `JobKeyService`): `epic_*` tools reach this epic only, `quest_create` and
 * `folio_create` file under it, and `quest_get`, `quest_update` and
 * `quest_objective_set` touch its quests only. Its starter's rank bounds the
 * rest (#Q4222: no tool allowlist).
 *
 * **Untrusted quests (the decision).** An epic may hold a quest born of
 * feedback written outside the team whose text no member confirmed. Such a
 * review is refused, saying which quests to confirm (#Q4222: no runner
 * isolates outside text any more). Not "keep those quests out of reach": a
 * review that cannot read part of its epic reviews a different plan than
 * the owner's, silently.
 *
 * The run itself is the `review-epic` prompt's (#Q4275); what stays here is
 * the epic's membership for the job key and its subject.
 */
export class EpicAgentService {
  /**
   * The job's subject, with the epic's number as its id.
   */
  public static readonly SUBJECT = "epic";

  protected readonly alepha = $inject(Alepha);
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);
  protected readonly projects = $repository(projects);
  protected readonly agents = $inject(AgentJobs);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly keys = $inject(JobKeyService);

  constructor() {
    this.keys.registerEpicMembership((projectId, epicNumber, quest) =>
      this.inEpic(projectId, epicNumber, quest),
    );
  }

  /**
   * What a run may pick now (#Q4223): each available Agent host with each
   * agent it reports. Empty, the robot menu offers no agent entry.
   */
  public async agentChoices(
    projectId: number,
  ): Promise<Array<{ host: string; agent?: string }>> {
    return this.agents.choices(projectId);
  }

  /**
   * Whether a quest is filed under an epic: the job key's pin reads it.
   */
  protected async inEpic(
    projectId: number,
    epicNumber: number,
    quest: { shortId?: number; id?: number },
  ): Promise<boolean> {
    const epic = await this.epics.findOne({
      where: { projectId: { eq: projectId }, number: { eq: epicNumber } },
    });
    if (!epic) return false;
    const row = await this.quests.findOne({
      where: {
        projectId: { eq: projectId },
        ...(quest.shortId !== undefined
          ? { shortId: { eq: quest.shortId } }
          : { id: { eq: quest.id as number } }),
      },
    });
    return row?.epicId === epic.id;
  }

  protected async find(projectId: number, number: number): Promise<Epic> {
    const epic = await this.epics.findOne({
      where: { projectId: { eq: projectId }, number: { eq: number } },
    });
    if (!epic) {
      throw new NotFoundError(`No epic ${number} in this project`);
    }
    return epic;
  }
}
