import { $inject } from "alepha";
import { audits } from "alepha/api/audits";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  $repository,
  DatabaseProvider,
  SqlExpressionProvider,
} from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { ProjectAnalytics } from "../entities/projectAnalytics.ts";
import { coreRelations } from "../relations/coreRelations.ts";
import { homeBoardSchema } from "../schemas/homeBoardSchema.ts";
import { ProjectCountRegistry } from "../services/ProjectCountRegistry.ts";
import { ProjectRecencyService } from "../services/ProjectRecencyService.ts";

/**
 * Home's own data: the momentum bars beside each project, when each project
 * last moved, and what is open in it.
 *
 * ## Why it is not on `getHomeOverview`
 *
 * That endpoint fills `userProjectsAtom`, which every page holds: the project
 * switcher, Spotlight, the account area. Home is one page, and an aggregate
 * over the audit log on every route change is a cost the other readers of
 * that atom never asked for. This action is the home page's, fetched when it
 * mounts and on an explicit refresh.
 *
 * ## No polling
 *
 * `DataTable` fetches on mount and on refresh, and nothing here is on an
 * interval. The QuestGraph incident (folio #1057) was a loader revalidating
 * once per second for 51 minutes: 4,009 identical requests from one tab,
 * roughly 35% of that day's account-wide Worker invocations. The landing page
 * is the worst place to reintroduce it.
 */
export class HomeController {
  /**
   * How many days of bars the Momentum column draws.
   *
   * Fourteen is two weeks, which is what makes a weekly rhythm visible: a
   * seven-day window shows one of every weekend dip and cannot tell a quiet
   * week from a quiet fortnight.
   */
  protected static readonly MOMENTUM_DAYS = 14;

  auditRows = $repository(audits);
  counts = $inject(ProjectCountRegistry);
  usersWith = $repository(coreRelations, "users");
  datasets = $inject(ProjectAnalytics);
  log = $logger();
  database = $inject(DatabaseProvider);
  sqlx = $inject(SqlExpressionProvider);
  dt = $inject(DateTimeProvider);
  recency = $inject(ProjectRecencyService);

  /**
   * Everything Home draws that `getHomeOverview` does not already carry.
   *
   * One action rather than two, because the page needs both before it is
   * worth looking at and both are answered from the same membership read.
   */
  getHomeBoard = $action({
    use: [
      /*
        The same window all four Reports actions have carried since they
        were written, and for the same reason: an aggregate a reader opens,
        looks at, and reloads a moment later.

        ⚠️ `private`, never `public`. The response is ONE viewer's project
        list, and the edge cache in the Worker entry stores anything public
        keyed by URL alone.

        60 seconds is also the staleness a viewer sees after their own
        write. On a projects overview that is fine; on a quest page it would
        not be.

        This removes repeat loads. It does not reduce what one load costs,
        so it is not a substitute for the two quests beside it in #E64.
      */
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
      $secure({ permissions: ["project:read"] }),
    ],
    schema: {
      response: homeBoardSchema,
    },
    handler: async ({ user }) => {
      const days = this.momentumDays();
      const projects = await this.memberProjects(user.id);

      // ⚠️ Short-circuited on an empty membership list: `inArray: []` THROWS
      // rather than matching nothing, and a brand-new account is exactly the
      // request that hits it.
      if (projects.length === 0) {
        return {
          days,
          momentum: [],
          lastActivity: [],
          openCounts: [],
        };
      }

      const [momentum, lastActivity, openCounts] = await Promise.all([
        this.momentum(
          projects.map((project) => String(project.id)),
          days,
        ),
        this.recency.lastActivity(projects),
        this.openCounts(projects.map((project) => project.id)),
      ]);

      return { days, momentum, lastActivity, openCounts };
    },
  });

  /**
   * The projects the viewer belongs to, most recently updated first.
   */
  protected async memberProjects(
    userId: string,
  ): Promise<Array<{ id: number; title: string; updatedAt: string }>> {
    const me = await this.usersWith.findById(userId, {
      include: {
        projects: {
          orderBy: { column: "updatedAt", direction: "desc" },
        },
      },
    });
    return me?.projects ?? [];
  }

  /**
   * Draft epics, open blights and pending feedback per project, each counted
   * by the module that owns it (`ProjectCountRegistry`, #E75 #Q2623) and all
   * three in ONE statement for every project at once; zero for a count no
   * module registered.
   *
   * Each count is what the project's sidebar badge counts, so the two never
   * disagree.
   */
  protected async openCounts(projectIds: number[]): Promise<
    Array<{
      projectId: number;
      epics: number;
      blights: number;
      feedback: number;
    }>
  > {
    const counts = await this.counts.countMany(
      ["draftEpics", "openBlights", "pendingFeedback"],
      projectIds,
    );
    const epics = counts.get("draftEpics") ?? new Map<number, number>();
    const blights = counts.get("openBlights") ?? new Map<number, number>();
    const feedback = counts.get("pendingFeedback") ?? new Map<number, number>();
    return projectIds.map((projectId) => ({
      projectId,
      epics: epics.get(projectId) ?? 0,
      blights: blights.get(projectId) ?? 0,
      feedback: feedback.get(projectId) ?? 0,
    }));
  }

  /**
   * The bars, as one question put to the `project_activity` dataset.
   *
   * ## It used to be SQL over `audits`, and that is what #E65 was about
   *
   * The statement it replaces read **13,428 rows a load** on production with
   * an already optimal plan: a range seek per project over exactly the
   * fourteen-day slice, plus a temp B-tree for a `GROUP BY` on a computed
   * `STRFTIME`. Fourteen days of activity simply IS 13,428 audit rows, so the
   * cost was where the events were stored, not how they were queried. On
   * production this now reads **zero D1 rows**: the hot tier of the dataset is
   * Analytics Engine.
   *
   * `select: { count: "sum" }` is the same `SUM(eventCount)` the old
   * statement did, and for the same reason: `$audit`'s `coalesce` folds a
   * burst of identical writes into one row carrying its count, so counting
   * rows would draw twenty minutes of quest edits as a single event and make
   * the busiest projects read as the quietest. `LoreAuditService` records one
   * point per `create()` call, which is what makes the two sums equal.
   *
   * `"day"` is the dataset's pseudo-dimension folding hour buckets, so the
   * keys come back as `YYYY-MM-DD` with no epoch arithmetic here - the same
   * labels {@link momentumDays} produces, in the same UTC convention.
   *
   * ## ⚠️ This read leaves the process, and Home must survive it failing
   *
   * Answered by an HTTP call into Analytics Engine on production. Every
   * Insights read 500'd for a day on 2026-08-11 and took the Apps pages down
   * with it; the landing page is the worst place to repeat that, so a failure
   * is caught to `undefined` and the strip renders empty. Logged rather than
   * swallowed silently, because a dead strip with no trace is its own
   * incident.
   *
   * Decided, and not surfaced: results carry `estimated: true`, but
   * `sampleInterval` is 1 at this volume, so the numbers are exact and
   * fourteen small bars are the wrong place for that disclosure.
   */
  protected async momentum(
    scopeIds: string[],
    days: string[],
  ): Promise<Array<{ projectId: number; counts: number[] }> | undefined> {
    const index = new Map(days.map((label, position) => [label, position]));
    const byProject = new Map<number, number[]>(
      scopeIds.map((id) => [Number(id), days.map(() => 0)]),
    );

    try {
      const result = await this.datasets.activity.query({
        since: days[0],
        where: { project: { inArray: scopeIds } },
        groupBy: ["day", "project"],
        select: { count: "sum" },
      });

      for (const row of result.rows) {
        const counts = byProject.get(Number(row.project));
        const position = index.get(String(row.day));
        // A bucket outside the labels is a boundary case, not an error: the
        // window is asked for by day and the labels are generated from the
        // clock, so the two can disagree by one at the edge.
        if (counts && position !== undefined) {
          counts[position] = Number(row.count) || 0;
        }
      }
    } catch (error) {
      this.log.warn("Momentum unavailable, rendering Home without the bars", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }

    return [...byProject].map(([projectId, counts]) => ({
      projectId,
      counts,
    }));
  }

  /**
   * The window's day labels, oldest first, in UTC.
   *
   * UTC because `SqlExpressionProvider.dateDay` buckets in UTC on both
   * dialects, and a label generated in another zone would name a bucket the
   * database never produced. The read is through `DateTimeProvider`, so a
   * test that travels sees the window move with it.
   */
  protected momentumDays(): string[] {
    const today = this.dt.nowMillis();
    const dayMs = 24 * 60 * 60 * 1000;
    const labels: string[] = [];
    for (let back = HomeController.MOMENTUM_DAYS - 1; back >= 0; back--) {
      labels.push(new Date(today - back * dayMs).toISOString().slice(0, 10));
    }
    return labels;
  }
}
