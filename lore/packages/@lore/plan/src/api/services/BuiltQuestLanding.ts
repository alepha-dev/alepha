import {
  BestEffort,
  BoundParameters,
  type CommitLanding,
  CommitReferenceRegistry,
  HostJobs,
} from "@lore/core/api";
import { formatReference } from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { QuestController } from "../controllers/QuestController.ts";
import { type Quest, quests } from "../entities/quests.ts";

/**
 * A quest an automation built completes when a commit naming it reaches the
 * default branch (#Q4234, the answer to #E172's review, question 2). Lore
 * watches no forge: the signal is the commit push CI already makes on the
 * default branch, whose whole-history set (`commit_quest_sets`) holds every
 * quest a message of that history names.
 *
 * - Only a quest **in progress** with a **build job of an automation** on it
 *   is completed. A quest worked by hand is never touched: completing it
 *   stays its member's or agent's act.
 * - It completes through `completeQuest`, as the automation's owner (the
 *   job's starter), so every rule of a completion holds: the default
 *   release, the epic's moves, the event, and the removal of its `q<n>`
 *   workspace on the hosts that ran it (#Q4218).
 * - The message names the commit and the pull requests recorded on the
 *   quest; the commit joins its trail. An objective the build job left
 *   unticked is waived with that reason: the merged work is the evidence.
 */
export class BuiltQuestLanding {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly registry = $inject(CommitReferenceRegistry);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly bound = $inject(BoundParameters);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly rows = $repository(quests);

  constructor() {
    this.registry.registerLanding(async (landing) => {
      await this.land(landing);
    });
  }

  /**
   * Completes the in-progress, automation-built quests a default-branch
   * commit names. Answers their numbers.
   */
  public async land(landing: CommitLanding): Promise<number[]> {
    if (!landing.numbers.length) return [];
    const open = (
      await this.bound.collect(landing.numbers, (batch) =>
        this.rows.findMany({
          where: {
            projectId: { eq: landing.projectId },
            shortId: { inArray: batch },
            acceptedAt: { isNotNull: true },
            completedAt: { isNull: true },
            shelvedAt: { isNull: true },
          },
        }),
      )
    ).filter((quest) => !quest.heldAt);
    if (!open.length) return [];
    const jobs = await this.hostJobs.automationJobsOn(
      landing.projectId,
      "quest",
      open.map((quest) => String(quest.shortId)),
    );
    const completed: number[] = [];
    for (const quest of open) {
      const job = jobs.find((it) => it.subjectId === String(quest.shortId));
      if (!job?.startedBy) continue;
      const done = await this.bestEffort.run(
        "a built quest could not be completed on its merge",
        () => this.complete(quest, job.startedBy as string, landing),
      );
      if (done) completed.push(quest.shortId);
    }
    return completed;
  }

  protected async complete(
    quest: Quest,
    owner: string,
    landing: CommitLanding,
  ): Promise<boolean> {
    const short = landing.commitSha.slice(0, 12);
    const pulls = (quest.pullRequests ?? []).map((pr) =>
      pr.number ? `#${pr.number} (${pr.url})` : pr.url,
    );
    const message = [
      `Built by an agent automation, completed when commit ${short} naming ${formatReference("quest", quest.shortId)} reached ${landing.branch}.`,
      pulls.length
        ? `Pull request: ${pulls.join(", ")}.`
        : "No pull request was recorded on the quest.",
    ].join(" ");
    // In a context of its own: the push's request memoises its caller's
    // rank and gate rows, and the completion is the owner's.
    await this.alepha.context.run(() =>
      this.alepha.inject(QuestController).completeQuest.run(
        {
          params: { id: quest.id },
          body: {
            message,
            commits: [{ sha: landing.commitSha }],
            waive: quest.objectives
              .filter(
                (objective) => !objective.completed && !objective.waivedAt,
              )
              .map((objective) => ({
                objectiveId: objective.id,
                reason: `Not ticked by the build job; its commit reached ${landing.branch}.`,
              })),
          },
        },
        { user: { id: owner, roles: ["user"] } },
      ),
    );
    return true;
  }
}
