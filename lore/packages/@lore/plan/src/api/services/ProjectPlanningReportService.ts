import { ReportStatistics } from "@lore/core/api";
import type { ReportsPlanning, ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, type PgQueryWhere } from "alepha/orm";

import { type Epic, epics } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";
import { QuestFlowService } from "./QuestFlowService.ts";
import { QuestHoldTime } from "./QuestHoldTime.ts";
import { ReleaseForecast } from "./ReleaseForecast.ts";

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
  protected readonly releases = $repository(releases);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly forecast = $inject(ReleaseForecast);
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
      releases: await this.releaseReport(projectId, query),
    };
  }

  /**
   * The last twelve full weeks of completions, oldest first: what the forecast
   * samples. Recent on purpose: the pace of a year ago is another project.
   */
  protected async weeklyThroughput(projectId: number): Promise<number[]> {
    const rows = await this.reports.completedByDay(
      projectId,
      this.reports.fixedQuery,
    );
    return this.series.weekly(rows, 12).map((point) => point.value);
  }

  protected async releaseReport(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsPlanning["releases"]> {
    const rows = await this.releases.findMany({
      where: { projectId: { eq: projectId } },
      columns: [
        "id",
        "tag",
        "title",
        "createdAt",
        "targetDate",
        "releasedAt",
        "inProgress",
        "total",
      ],
    });
    const label = (row: (typeof rows)[number]) => row.tag ?? row.title;
    const openRows = rows.filter((row) => !row.releasedAt);
    const published = rows
      .filter((row) => row.releasedAt)
      .toSorted((a, b) => b.releasedAt!.localeCompare(a.releasedAt!));

    const members = await this.quests.findMany({
      where: {
        projectId: { eq: projectId },
        releaseId: { isNotNull: true },
        shelvedAt: { isNull: true },
      },
      columns: ["releaseId", "completedAt"],
    });
    const tally = (id: number) => {
      const own = members.filter((quest) => quest.releaseId === id);
      return {
        total: own.length,
        done: own.filter((quest) => quest.completedAt).length,
      };
    };

    const open = openRows
      .map((row) => ({ row, ...tally(row.id) }))
      .filter((it) => it.total > 0)
      .toSorted((a, b) =>
        (a.row.targetDate ?? "9999").localeCompare(b.row.targetDate ?? "9999"),
      )
      .slice(0, 3);
    const throughput = open.length
      ? await this.weeklyThroughput(projectId)
      : [];

    return {
      open: await Promise.all(
        open.map(async ({ row, total, done }) => {
          const axis = this.series.between(
            row.createdAt,
            this.dt.nowISOString(),
          );
          const points = await this.flow.points(
            projectId,
            this.series
              .sampled(
                axis.map((at) => ({ at })),
                query.grain ?? this.series.grainFor(axis.length),
              )
              .map((point) => point.at),
            { releaseId: row.id },
          );
          const weeks = this.forecast.weeks(total - done, throughput);
          const inWeeks = (count: number) =>
            this.dt
              .now()
              .add(count * 7, "day")
              .toISOString()
              .slice(0, 10);
          return {
            id: row.id,
            label: label(row),
            ...(row.targetDate ? { targetDate: row.targetDate } : {}),
            done,
            total,
            burnup: points.map((point) => ({
              date: point.date,
              done: point.done,
              scope: point.todo + point.inProgress + point.onHold + point.done,
            })),
            ...(weeks
              ? {
                  forecast: {
                    p50: inWeeks(weeks.p50),
                    p85: inWeeks(weeks.p85),
                  },
                }
              : {}),
          };
        }),
      ),
      published: published.map((row, index) => {
        const released = this.dt.of(row.releasedAt!).valueOf();
        const previous = published[index + 1]?.releasedAt;
        return {
          id: row.id,
          label: label(row),
          releasedAt: row.releasedAt!,
          ...(row.targetDate
            ? {
                slipDays:
                  (released - this.dt.of(row.targetDate).valueOf()) /
                  86_400_000,
              }
            : {}),
          size: row.total ?? 0,
          carriedOver: row.inProgress ?? 0,
          ...(previous
            ? {
                cadenceDays:
                  (released - this.dt.of(previous).valueOf()) / 86_400_000,
              }
            : {}),
        };
      }),
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
