import { type HostJobSummary, projectEvents } from "@lore/core/api";
import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { questComments } from "../entities/questComments.ts";
import { quests } from "../entities/quests.ts";
import { QuestResourceMapper } from "./QuestResourceMapper.ts";

/**
 * A job that ends unfinished says so on its quests (#Q4341): when an agent
 * job ends on a timeout, an error or a cancel, every quest it accepted and
 * left open gets a comment naming the job and how it ended, so the quest is
 * never left in progress without a word. It stays in progress and assigned:
 * Run again on the job continues its workspace (#Q4340).
 *
 * Which quests the job accepted is read from the `quest.assigned` events
 * its key recorded, which carry its id, so a quest a member accepted while
 * the job ran is left alone. The comment is written as the job's starter,
 * the key's owner, marked as an agent's.
 */
export class UnfinishedJobQuests {
  /**
   * The client the comment names, beside the starter.
   */
  public static readonly CLIENT = "lore-jobs";

  protected readonly log = $logger();
  protected readonly events = $repository(projectEvents);
  protected readonly quests = $repository(quests);
  protected readonly comments = $repository(questComments);
  protected readonly mapper = $inject(QuestResourceMapper);

  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      try {
        await this.report(job);
      } catch (error) {
        this.log.warn("could not comment on an unfinished job's quests", {
          jobId: job.id,
          error,
        });
      }
    },
  });

  /**
   * Comments on each quest the job accepted and left open, and answers
   * their numbers.
   */
  public async report(job: HostJobSummary): Promise<number[]> {
    if (job.kind !== "agent" || !job.startedBy) return [];
    const how = this.endOf(job.status);
    if (!how) return [];
    const accepted = await this.events.findMany({
      where: {
        projectId: { eq: job.projectId },
        name: { eq: "quest.assigned" },
        jobId: { eq: job.id },
        ...(job.startedAt ? { occurredAt: { gte: job.startedAt } } : {}),
      },
    });
    const numbers = [
      ...new Set(
        accepted
          .map((it) => Number(it.subjectId))
          .filter((it) => Number.isInteger(it)),
      ),
    ];
    const commented: number[] = [];
    for (const shortId of numbers) {
      const quest = await this.quests.findOne({
        where: { projectId: { eq: job.projectId }, shortId: { eq: shortId } },
      });
      if (!quest || quest.deletedAt) continue;
      const status = this.mapper.questStatus(quest);
      if (status !== "in_progress" && status !== "on_hold") continue;
      await this.comments.create({
        questId: quest.id,
        authorId: job.startedBy,
        body: this.bodyOf(job, how),
        source: { kind: "mcp", client: UnfinishedJobQuests.CLIENT },
      });
      commented.push(shortId);
    }
    return commented;
  }

  /**
   * How a job ended, in words, or undefined for an end that is not
   * unfinished.
   */
  protected endOf(status: HostJobSummary["status"]): string | undefined {
    if (status === "timed_out") return "timed out";
    if (status === "failed") return "failed";
    if (status === "cancelled") return "was cancelled";
    return undefined;
  }

  protected bodyOf(job: HostJobSummary, how: string): string {
    const name = job.prompt ? `the ${job.prompt} job` : "the agent job";
    const reason = job.reason ? ` (${job.reason.slice(0, 300)})` : "";
    const kept = job.warning ? ` Its host ${job.warning}.` : "";
    return [
      `Job \`${job.id.slice(0, 8)}\`, ${name} that accepted this quest, ${how}${reason} before completing it.${kept}`,
      "",
      "The quest stays in progress, assigned. **Run again** on the job continues it in its workspace and on its branch; otherwise pick it up by hand.",
    ].join("\n");
  }
}
