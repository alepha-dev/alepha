import { AgentJobSteps, type AgentJobStepsJob } from "@lore/core/api";
import type { AgentJobStepsValue } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";

/**
 * Plan's reader on core's `AgentJobSteps` port (#Q4433, epic #E181): a
 * job's steps, read from the quests its key accepted (`workedByJobId`),
 * never counted on the job row, so a recount is always right and nothing
 * races on a database without transactions.
 *
 * - `work-loose-quests` accepts its whole list at the start: what it
 *   accepted is its total.
 * - `work-epic` accepts one quest at a time: its total is its epic's quests
 *   not shelved and not completed before it started, and the ones it has
 *   not accepted yet are `pending`.
 * - `work-quest` works one quest: its objectives are the steps.
 *
 * A list of jobs is read in three queries whatever its length: the quests
 * the jobs worked, the epics of the `work-epic` ones, and those epics'
 * quests.
 */
export class QuestJobSteps {
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly port = $inject(AgentJobSteps);

  constructor() {
    this.port.register({ read: (jobs) => this.read(jobs) });
  }

  public async read(
    jobs: AgentJobStepsJob[],
  ): Promise<Map<string, AgentJobStepsValue>> {
    const out = new Map<string, AgentJobStepsValue>();
    if (!jobs.length) return out;
    const projectIds = [...new Set(jobs.map((job) => job.projectId))];
    const worked = await this.quests.findMany({
      where: {
        projectId: { inArray: projectIds },
        workedByJobId: { inArray: jobs.map((job) => job.id) },
      },
      columns: QuestJobSteps.COLUMNS,
    });
    const epicQuests = await this.epicQuestsOf(jobs);
    for (const job of jobs) {
      const steps = this.stepsOf(
        job,
        worked.filter(
          (quest) =>
            quest.workedByJobId === job.id && quest.projectId === job.projectId,
        ),
        epicQuests.get(job.id) ?? [],
      );
      if (steps) out.set(job.id, steps);
    }
    return out;
  }

  protected static readonly COLUMNS = [
    "id",
    "projectId",
    "shortId",
    "title",
    "acceptedAt",
    "completedAt",
    "shelvedAt",
    "objectives",
    "history",
    "workedByJobId",
    "epicId",
  ] as const satisfies Array<keyof Quest>;

  /**
   * The quests of each `work-epic` job's epic (its `epic` arg), by job id.
   */
  protected async epicQuestsOf(
    jobs: AgentJobStepsJob[],
  ): Promise<Map<string, StepQuest[]>> {
    const byJob = new Map<string, StepQuest[]>();
    const wanted = jobs.flatMap((job) => {
      const number = this.epicNumberOf(job);
      return number ? [{ job, number }] : [];
    });
    if (!wanted.length) return byJob;
    const rows = await this.epics.findMany({
      where: {
        projectId: {
          inArray: [...new Set(wanted.map((it) => it.job.projectId))],
        },
        number: { inArray: [...new Set(wanted.map((it) => it.number))] },
      },
      columns: ["id", "projectId", "number"],
    });
    const epicIds = rows.map((row) => row.id);
    const list = epicIds.length
      ? await this.quests.findMany({
          where: { epicId: { inArray: epicIds }, shelvedAt: { isNull: true } },
          columns: QuestJobSteps.COLUMNS,
        })
      : [];
    for (const { job, number } of wanted) {
      const epic = rows.find(
        (row) => row.projectId === job.projectId && row.number === number,
      );
      if (epic) {
        byJob.set(
          job.id,
          list.filter((quest) => quest.epicId === epic.id),
        );
      }
    }
    return byJob;
  }

  /**
   * A `work-epic` job's epic number, from its `epic` arg.
   */
  protected epicNumberOf(job: AgentJobStepsJob): number | undefined {
    if (job.prompt !== "work-epic") return undefined;
    const arg = job.args?.find((it) => it.type === "epic");
    const number = Number(arg?.value.match(/\d+/)?.[0]);
    return Number.isInteger(number) && number > 0 ? number : undefined;
  }

  /**
   * One job's steps, or nothing for a job with no quest to count.
   */
  public stepsOf(
    job: AgentJobStepsJob,
    worked: StepQuest[],
    epicQuests: StepQuest[],
  ): AgentJobStepsValue | undefined {
    const from = job.startedAt ?? job.queuedAt;
    const to = job.endedAt;
    const inWindow = (at: string | undefined): at is string =>
      !!at && at >= from && (!to || at <= to);

    const entries = worked
      .map((quest) => {
        const accepts = quest.history.filter(
          (entry) => entry.action === "assigned" && inWindow(entry.at),
        );
        const acceptedAt =
          accepts.at(-1)?.at ??
          (inWindow(quest.acceptedAt) ? quest.acceptedAt : undefined);
        const completed = new Set(
          quest.objectives.filter((it) => it.completed).map((it) => it.id),
        );
        const ticks = quest.history
          .filter(
            (entry) =>
              entry.action === "objective_completed" &&
              entry.objectiveId !== undefined &&
              completed.has(entry.objectiveId) &&
              inWindow(entry.at),
          )
          .map((entry) => entry.at)
          .sort();
        const completedAt =
          quest.completedAt && (!to || quest.completedAt <= to)
            ? quest.completedAt
            : undefined;
        return { quest, acceptedAt, completedAt, ticks };
      })
      .sort(
        (a, b) =>
          (a.acceptedAt ?? "￿").localeCompare(b.acceptedAt ?? "￿") ||
          a.quest.shortId - b.quest.shortId,
      );

    const workedIds = new Set(worked.map((quest) => quest.id));
    const pending = epicQuests
      .filter(
        (quest) =>
          !workedIds.has(quest.id) &&
          !(quest.completedAt && quest.completedAt < from),
      )
      .sort((a, b) => a.shortId - b.shortId)
      .map((quest) => ({ shortId: quest.shortId, title: quest.title }));

    if (!entries.length && !pending.length) return undefined;

    const latest = (times: Array<string | undefined>) =>
      times
        .filter((at): at is string => !!at)
        .sort()
        .at(-1);
    const current = entries
      .filter((entry) => !entry.completedAt)
      .map((entry) => ({
        shortId: entry.quest.shortId,
        at: latest([entry.acceptedAt, ...entry.ticks]) ?? "",
      }))
      .sort((a, b) => a.at.localeCompare(b.at))
      .at(-1)?.shortId;
    const lastStepAt = latest(
      entries.flatMap((entry) => [
        entry.acceptedAt,
        entry.completedAt,
        ...entry.ticks,
      ]),
    );

    const quests = entries.map((entry) => ({
      shortId: entry.quest.shortId,
      title: entry.quest.title,
      ...(entry.acceptedAt ? { acceptedAt: entry.acceptedAt } : {}),
      ...(entry.completedAt ? { completedAt: entry.completedAt } : {}),
      objectives: {
        total: entry.quest.objectives.length,
        done: entry.quest.objectives.filter((it) => it.completed).length,
        waived: entry.quest.objectives.filter(
          (it) => !it.completed && it.waivedReason,
        ).length,
      },
    }));

    const one = job.prompt === "work-quest" ? entries[0] : undefined;
    if (one) {
      const objectives = quests[0]?.objectives ?? {
        total: 0,
        done: 0,
        waived: 0,
      };
      return {
        unit: "objective",
        total: objectives.total - objectives.waived,
        done: objectives.done,
        quests,
        pending: [],
        ...(current === undefined ? {} : { current }),
        ...(lastStepAt ? { lastStepAt } : {}),
        stepTimes: one.ticks.slice(0, 500),
      };
    }
    const stepTimes = entries
      .flatMap((entry) => (entry.completedAt ? [entry.completedAt] : []))
      .sort();
    return {
      unit: "quest",
      total: quests.length + pending.length,
      done: stepTimes.length,
      quests: quests.slice(0, 200),
      pending: pending.slice(0, 200),
      ...(current === undefined ? {} : { current }),
      ...(lastStepAt ? { lastStepAt } : {}),
      stepTimes,
    };
  }
}

/**
 * The columns of a quest the steps read.
 */
export type StepQuest = Pick<
  Quest,
  | "id"
  | "projectId"
  | "shortId"
  | "title"
  | "acceptedAt"
  | "completedAt"
  | "shelvedAt"
  | "objectives"
  | "history"
  | "workedByJobId"
  | "epicId"
>;
