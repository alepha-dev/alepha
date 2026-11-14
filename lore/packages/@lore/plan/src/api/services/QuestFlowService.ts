import { BestEffort, ReportStatistics } from "@lore/core/api";
import { projectCapabilities, type ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, type PgQueryWhere } from "alepha/orm";

import {
  type QuestFlowDaily,
  questFlowDaily,
} from "../entities/questFlowDaily.ts";
import { quests } from "../entities/quests.ts";
import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";
import {
  QuestFlowHistory,
  type QuestFlowRow,
  type QuestFlowState,
} from "./QuestFlowHistory.ts";

export type QuestFlowCounts = Record<QuestFlowState, number>;

export interface QuestFlowPoint extends QuestFlowCounts {
  date: string;
  /**
   * Whether the point is a nightly snapshot, or a reconstruction.
   */
  exact: boolean;
}

/**
 * The state of a project's quests over time (#Q2998): the nightly
 * `quest_flow_daily` snapshot, and the reconstruction for what came before it.
 *
 * Both fold through `QuestFlowHistory`, so a snapshot and the reconstruction
 * of the same day cannot disagree on what a state is.
 */
export class QuestFlowService {
  protected readonly quests = $repository(quests);
  protected readonly daily = $repository(questFlowDaily);
  protected readonly capabilities = $repository(projectCapabilities);
  protected readonly history = $inject(QuestFlowHistory);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly epicVisibility = $inject(EpicVisibilityService);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly series = $inject(DashboardFlowSeries);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly bestEffort = $inject(BestEffort);

  /**
   * The state counts on each day of `axis`, oldest first.
   *
   * A snapshot serves a query it has a row for: the whole project, or one
   * area, epic or release. A filter on tag, priority or member, or on two
   * dimensions at once, has none, and every day is reconstructed.
   */
  async points(
    projectId: number,
    axis: string[],
    query: ReportsQuery,
  ): Promise<QuestFlowPoint[]> {
    const subject = this.subjectOf(query);
    const stored = subject
      ? await this.daily.findMany({
          where: {
            projectId: { eq: projectId },
            dimension: { eq: subject.dimension },
            subject: { eq: subject.subject },
            // A range and never `inArray: axis`: a year is 365 bound values,
            // and D1 refuses more than 100 in a statement.
            day: { gte: axis[0], lte: axis.at(-1) },
          },
        })
      : [];
    const byDay = new Map(stored.map((row) => [row.day, row]));
    const missing = axis.filter((day) => !byDay.has(day));
    const rebuilt = new Map<string, QuestFlowCounts>();
    if (missing.length > 0) {
      const rows = await this.rows(await this.flowScope(projectId, query));
      for (const day of missing) {
        rebuilt.set(day, this.count(rows, day));
      }
    }
    return axis.map((date) => {
      const row = byDay.get(date);
      return row
        ? {
            date,
            todo: row.todo,
            inProgress: row.inProgress,
            onHold: row.onHold,
            done: row.done,
            exact: true,
          }
        : { date, ...this.empty(), ...rebuilt.get(date), exact: false };
    });
  }

  /**
   * Median and p85 hours per board column, over the quests holding a `moved`
   * event. A held quest's stay counts: it did sit in that column.
   */
  async columnTimes(
    projectId: number,
    query: ReportsQuery,
  ): Promise<
    Array<{
      column: string;
      quests: number;
      medianHours: number;
      p85Hours: number;
    }>
  > {
    const rows = await this.quests.findMany({
      where: {
        ...(await this.reports.scopeOf(projectId, query)),
        history: { like: '%"moved"%' },
      } as PgQueryWhere<typeof quests.schema>,
      columns: ["history", "completedAt"],
    });
    const now = this.dt.nowMillis();
    const hours = new Map<string, number[]>();
    for (const row of rows) {
      const until = row.completedAt
        ? this.dt.of(row.completedAt).valueOf()
        : now;
      for (const [column, ms] of this.history.columnTimes(row.history, until)) {
        hours.set(column, [...(hours.get(column) ?? []), ms / 3_600_000]);
      }
    }
    return [...hours.entries()]
      .map(([column, values]) => ({
        column,
        quests: values.length,
        medianHours: this.stats.median(values),
        p85Hours: this.stats.percentile(values, 85),
      }))
      .sort((a, b) => a.column.localeCompare(b.column));
  }

  /**
   * Write `day` for every project with Work on. One project failing costs that
   * project's row, not the night's.
   */
  async snapshotAll(day: string): Promise<number> {
    const enabled = await this.capabilities.findMany({
      where: { key: { eq: "plan" } },
      columns: ["projectId"],
    });
    let written = 0;
    for (const { projectId } of enabled) {
      written +=
        (await this.bestEffort.run(
          `quest flow snapshot of project ${projectId}`,
          () => this.snapshot(projectId, day),
        )) ?? 0;
    }
    return written;
  }

  /**
   * The rows of `day`, replacing any already there: a retried job writes the
   * same night twice, and D1 has no transaction to make that one write.
   *
   * ⚠️ The project and area rows apply the backlog gate, as every report does;
   * an epic's rows do not, since a draft epic's burn-up starts before it opens.
   */
  async snapshot(projectId: number, day: string): Promise<number> {
    const rows = await this.rows({
      projectId: { eq: projectId },
    });
    const drafts = new Set(await this.epicVisibility.draftEpicIds(projectId));
    const at = this.history.endOf(day);
    const groups = new Map<string, QuestFlowCounts>();
    const add = (
      dimension: QuestFlowDaily["dimension"],
      subject: string,
      state: QuestFlowState,
    ) => {
      const key = `${dimension}\u0000${subject}`;
      const counts = groups.get(key) ?? this.empty();
      counts[state] += 1;
      groups.set(key, counts);
    };

    for (const row of rows) {
      const state = this.history.stateAt(row, at);
      if (!state) {
        continue;
      }
      const gated =
        state !== "done" && row.epicId !== undefined && drafts.has(row.epicId);
      if (!gated) {
        add("project", "", state);
        add("area", row.area, state);
      }
      if (row.epicId !== undefined) {
        add("epic", String(row.epicId), state);
      }
      if (row.releaseId !== undefined) {
        add("release", String(row.releaseId), state);
      }
    }

    await this.daily.deleteMany({
      projectId: { eq: projectId },
      day: { eq: day },
    });
    const inserts = [...groups.entries()].map(([key, counts]) => {
      const [dimension, subject] = key.split("\u0000") as [
        QuestFlowDaily["dimension"],
        string,
      ];
      return { projectId, day, dimension, subject, ...counts };
    });
    await this.daily.createMany(inserts);
    return inserts.length;
  }

  /**
   * The snapshot row a query can read, if any. The period and thresholds do
   * not narrow a row; the Work filters do.
   */
  protected subjectOf(
    query: ReportsQuery,
  ): { dimension: QuestFlowDaily["dimension"]; subject: string } | undefined {
    if (query.tag || query.priority || query.memberId) {
      return undefined;
    }
    const narrowed = [
      query.area !== undefined &&
        ({ dimension: "area", subject: query.area } as const),
      query.epicId !== undefined &&
        ({ dimension: "epic", subject: String(query.epicId) } as const),
      query.releaseId !== undefined &&
        ({ dimension: "release", subject: String(query.releaseId) } as const),
    ].filter((it) => !!it);
    if (narrowed.length > 1) {
      return undefined;
    }
    return narrowed[0] ?? { dimension: "project", subject: "" };
  }

  /**
   * The report's scope, with shelved quests put back: one shelved today sat
   * in a state before that, and `stateAt` is what leaves it out.
   */
  protected async flowScope(
    projectId: number,
    query: ReportsQuery,
  ): Promise<PgQueryWhere<typeof quests.schema>> {
    const { shelvedAt: _shelved, ...scope } = await this.reports.scopeOf(
      projectId,
      query,
    );
    return scope;
  }

  /**
   * The narrow columns of every quest in `where`, with `history` only on the
   * few whose past differs from their timestamps: it is the heavy column.
   */
  protected async rows(where: PgQueryWhere<typeof quests.schema>) {
    const [rows, moved] = await Promise.all([
      this.quests.findMany({
        where,
        columns: [
          "id",
          "createdAt",
          "acceptedAt",
          "completedAt",
          "heldAt",
          "shelvedAt",
          "epicId",
          "releaseId",
          "area",
        ],
      }),
      this.quests.findMany({
        where: {
          and: [
            where,
            {
              or: [
                { history: { like: '%"held"%' } },
                { history: { like: '%"shelved"%' } },
                { history: { like: '%"unassigned"%' } },
              ],
            },
          ],
        } as PgQueryWhere<typeof quests.schema>,
        columns: ["id", "history"],
      }),
    ]);
    const historyOf = new Map(moved.map((row) => [row.id, row.history]));
    return rows.map((row) => ({ ...row, history: historyOf.get(row.id) }));
  }

  protected count(rows: QuestFlowRow[], day: string): QuestFlowCounts {
    const at = this.history.endOf(day);
    const counts = this.empty();
    for (const row of rows) {
      const state = this.history.stateAt(row, at);
      if (state) {
        counts[state] += 1;
      }
    }
    return counts;
  }

  protected empty(): QuestFlowCounts {
    return { todo: 0, inProgress: 0, onHold: 0, done: 0 };
  }
}
