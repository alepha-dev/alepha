import {
  CommentService,
  type HostJobSummary,
  projectEvents,
} from "@lore/core/api";
import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { type Quest, quests } from "../entities/quests.ts";
import { PlanCommentSubjects } from "./PlanCommentSubjects.ts";
import { QuestResourceMapper } from "./QuestResourceMapper.ts";

/**
 * A job that ends unfinished says so on its quests (#Q4341): when an agent
 * job ends on a timeout, an error or a cancel, every quest it accepted and
 * left open gets a comment naming the job and how it ended, so the quest is
 * never left in progress without a word. A quest the job holds by its
 * stamp (#Q4350) goes back to To do at the job's end, whatever its status,
 * so the next run finds it; Run again on the job continues its workspace
 * (#Q4340).
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
  protected readonly comments = $inject(CommentService);
  protected readonly mapper = $inject(QuestResourceMapper);
  protected readonly dateTime = $inject(DateTimeProvider);

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
   * At the job's end, whatever its status: each quest it holds goes back to
   * To do (#Q4350), and on an unfinished end each quest it accepted and left
   * open gets a comment (#Q4341). Answers the numbers it commented on.
   */
  public async report(job: HostJobSummary): Promise<number[]> {
    if (job.kind !== "agent") return [];
    const how = this.endOf(job.status);
    const stamped = await this.quests.findMany({
      where: {
        projectId: { eq: job.projectId },
        agentJobId: { eq: job.id },
      },
    });
    // A job from before the stamp is known by the accepts its key recorded.
    const accepted =
      how && job.startedBy
        ? await this.events.findMany({
            where: {
              projectId: { eq: job.projectId },
              name: { eq: "quest.assigned" },
              jobId: { eq: job.id },
              ...(job.startedAt ? { occurredAt: { gte: job.startedAt } } : {}),
            },
          })
        : [];
    const numbers = [
      ...new Set([
        ...stamped.map((it) => it.shortId),
        ...accepted
          .map((it) => Number(it.subjectId))
          .filter((it) => Number.isInteger(it)),
      ]),
    ];
    const commented: number[] = [];
    for (const shortId of numbers) {
      const quest =
        stamped.find((it) => it.shortId === shortId) ??
        (await this.quests.findOne({
          where: {
            projectId: { eq: job.projectId },
            shortId: { eq: shortId },
          },
        }));
      if (!quest || quest.deletedAt) continue;
      const status = this.mapper.questStatus(quest);
      if (status !== "in_progress" && status !== "on_hold") {
        if (quest.agentJobId === job.id) {
          await this.quests.updateById(quest.id, {
            agentJobId: null,
            agentName: null,
          } as never);
        }
        continue;
      }
      const handBack = quest.agentJobId === job.id;
      if (how && job.startedBy) {
        await this.comments.add({
          type: PlanCommentSubjects.QUEST,
          projectId: quest.projectId,
          subjectId: quest.id,
          authorId: job.startedBy,
          body: this.bodyOf(job, how, handBack),
          source: { kind: "mcp", client: UnfinishedJobQuests.CLIENT },
        });
        commented.push(shortId);
      }
      if (handBack) await this.handBack(quest, job);
    }
    return commented;
  }

  /**
   * A quest its ended job held, back to To do (#Q4350): unassigned, its
   * timer stopped, with an `unassigned` history line naming the job. Its
   * comments, commits and pull request stay.
   */
  protected async handBack(quest: Quest, job: HostJobSummary): Promise<void> {
    const at = this.dateTime.nowISOString();
    const by = job.startedBy ?? quest.acceptedBy;
    const timerSessions = (quest.timerSessions ?? []).map((session) =>
      session.stoppedAt ? session : { ...session, stoppedAt: at },
    );
    await this.quests.updateById(quest.id, {
      acceptedAt: null,
      acceptedBy: null,
      agentJobId: null,
      agentName: null,
      kanbanColumn: null,
      reminderInterval: null,
      reminderNextAt: null,
      timerSessions,
      history: by
        ? [
            ...quest.history,
            { at, by, action: "unassigned" as const, jobId: job.id },
          ]
        : quest.history,
    } as never);
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

  protected bodyOf(
    job: HostJobSummary,
    how: string,
    handedBack: boolean,
  ): string {
    const name = job.prompt ? `the ${job.prompt} job` : "the agent job";
    const reason = job.reason ? ` (${job.reason.slice(0, 300)})` : "";
    const kept = job.warning ? ` Its host ${job.warning}.` : "";
    return [
      `Job \`${job.id.slice(0, 8)}\`, ${name} that accepted this quest, ${how}${reason} before completing it.${kept}`,
      "",
      handedBack
        ? "The quest is back in To do, for the next run or for you. **Run again** on the job continues it in its workspace and on its branch, where the work it left is."
        : "The quest stays in progress, assigned. **Run again** on the job continues it in its workspace and on its branch; otherwise pick it up by hand.",
    ].join("\n");
  }
}
