import { ReportStatistics } from "@lore/core/api";
import type { ReportsPlanning, ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, type PgQueryWhere } from "alepha/orm";

import { type Epic, epics } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";
import { QuestFlowService } from "./QuestFlowService.ts";
import { QuestHoldTime } from "./QuestHoldTime.ts";

/**
 * The Planning tab's report (#Q3003): epics and their scope.
 *
 * ⚠️ **What "scope added" can see.** An epic's quest set freezes once it
 * starts, so after `startedAt` a quest joins or leaves only by being shelved,
 * or through an edit made before the freeze existed (#E31). What moved is read
 * from `history.changes`, whose `epic` entries carry the epic's number as a
 * display string, not an id: a renumbered epic's past moves no longer match.
 */
export class ProjectPlanningReportService {
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);
  protected readonly flow = $inject(QuestFlowService);
  protected readonly series = $inject(DashboardFlowSeries);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly holdTime = $inject(QuestHoldTime);
  protected readonly dt = $inject(DateTimeProvider);

  async report(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsPlanning> {
    const where: PgQueryWhere<typeof epics.schema> = {
      projectId: { eq: projectId },
      startedAt: { isNotNull: true },
    };
    if (query.releaseId !== undefined) {
      where.releaseId = { eq: query.releaseId };
    }
    const rows = (
      await this.epics.findMany({
        where,
        columns: [
          "id",
          "number",
          "title",
          "status",
          "startedAt",
          "completedAt",
        ],
        orderBy: { column: "startedAt", direction: "asc" },
      })
    ).filter(
      (epic) =>
        (!query.from || !epic.completedAt || epic.completedAt >= query.from) &&
        (!query.to || !epic.startedAt || epic.startedAt <= query.to),
    );

    const [members, moved] = await Promise.all([
      this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          epicId: { isNotNull: true },
        },
        columns: [
          "id",
          "epicId",
          "createdAt",
          "acceptedAt",
          "completedAt",
          "shelvedAt",
        ],
      }),
      this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          or: [
            { history: { like: '%"field":"epic"%' } },
            { history: { like: '%"held"%' } },
          ],
        } as PgQueryWhere<typeof quests.schema>,
        columns: ["id", "epicId", "history"],
      }),
    ]);
    const historyOf = new Map(moved.map((row) => [row.id, row.history]));

    const report = rows.map((epic) =>
      this.epicRow(epic, members, moved, historyOf),
    );

    return {
      epics: report,
      burnup: await this.burnup(projectId, rows, query),
    };
  }

  protected epicRow(
    epic: Pick<
      Epic,
      "id" | "number" | "title" | "status" | "startedAt" | "completedAt"
    >,
    members: Array<
      Pick<
        Quest,
        | "id"
        | "epicId"
        | "createdAt"
        | "acceptedAt"
        | "completedAt"
        | "shelvedAt"
      >
    >,
    moved: Array<Pick<Quest, "id" | "epicId" | "history">>,
    historyOf: Map<number, Quest["history"]>,
  ): ReportsPlanning["epics"][number] {
    const startedAt = epic.startedAt as string;
    const started = this.dt.of(startedAt).valueOf();
    const after = (at: string) => this.dt.of(at).valueOf() > started;
    const own = members.filter((quest) => quest.epicId === epic.id);
    const live = own.filter((quest) => !quest.shelvedAt);
    const done = live.filter((quest) => quest.completedAt);

    const matches = (value: string | undefined) =>
      value?.replace(/\D/g, "") === String(epic.number);
    const movedAfterStart = (
      quest: Pick<Quest, "id">,
      side: "from" | "to",
    ): boolean =>
      (historyOf.get(quest.id) ?? []).some(
        (entry) =>
          after(entry.at) &&
          entry.changes?.some(
            (change) => change.field === "epic" && matches(change[side]),
          ),
      );

    const scopeAdded = own.filter(
      (quest) => after(quest.createdAt) || movedAfterStart(quest, "to"),
    ).length;
    const scopeCut =
      own.filter((quest) => quest.shelvedAt && after(quest.shelvedAt)).length +
      moved.filter(
        (quest) => quest.epicId !== epic.id && movedAfterStart(quest, "from"),
      ).length;
    const baseline = Math.max(own.length - scopeAdded, 1);

    const cycle = done.flatMap((quest) => {
      if (!quest.acceptedAt || !quest.completedAt) {
        return [];
      }
      const from = this.dt.of(quest.acceptedAt).valueOf();
      const until = this.dt.of(quest.completedAt).valueOf();
      const held = this.holdTime.within(
        historyOf.get(quest.id) ?? [],
        from,
        until,
      );
      return [Math.max(until - from - held, 0) / 3_600_000];
    });
    const end = epic.completedAt
      ? this.dt.of(epic.completedAt).valueOf()
      : this.dt.nowMillis();

    return {
      id: epic.id,
      number: epic.number,
      title: epic.title,
      status: epic.status,
      startedAt,
      ...(epic.completedAt ? { completedAt: epic.completedAt } : {}),
      done: done.length,
      total: live.length,
      medianCycleHours: this.stats.median(cycle),
      daysInProgress: (end - started) / 86_400_000,
      scopeAdded,
      scopeCut,
      scopeChange: ((scopeAdded + scopeCut) / baseline) * 100,
    };
  }

  /**
   * From the day the epic started, through `QuestFlowService`: its nightly
   * rows where they exist, and the reconstruction before them.
   */
  protected async burnup(
    projectId: number,
    rows: Array<
      Pick<Epic, "id" | "title" | "startedAt" | "completedAt" | "status">
    >,
    query: ReportsQuery,
  ): Promise<ReportsPlanning["burnup"]> {
    const epic =
      rows.find((it) => it.id === query.epicId) ??
      rows.findLast((it) => it.status === "in_progress") ??
      rows.at(-1);
    if (!epic?.startedAt) {
      return undefined;
    }
    const axis = this.series.between(
      epic.startedAt,
      epic.completedAt ?? this.dt.nowISOString(),
    );
    const sampled = this.series
      .sampled(
        axis.map((at) => ({ at })),
        query.grain ?? this.series.grainFor(axis.length),
      )
      .map((point) => point.at);
    const points = await this.flow.points(projectId, sampled, {
      epicId: epic.id,
    });
    return {
      epicId: epic.id,
      title: epic.title,
      points: points.map((point) => ({
        date: point.date,
        done: point.done,
        scope: point.todo + point.inProgress + point.onHold + point.done,
      })),
    };
  }
}
