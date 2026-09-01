import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import type { Project } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import type { ActiveQuestsFilters } from "../schemas/activeQuestsFiltersSchema.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { OpenQuestScope } from "./OpenQuestScope.ts";

/**
 * The backlog pulse: `new + accepted`, with the split in the footer.
 *
 * ## The count is the quests list's own count
 *
 * The where-shape comes from `OpenQuestScope`, which is also what the sidebar
 * badge and the dashboard rail count with. That sharing is the point: this
 * tile, the rail beside it and the list it links to are all on screen
 * together, and two of them disagreeing is one of them lying. This app has
 * already shipped that bug once, with a badge reading 2 over a visibly empty
 * list.
 *
 * ## The link deliberately disagrees with the count
 *
 * ⚠️ The tile counts `new + accepted`; clicking opens `status=new` only. The
 * questlog rail down the left of the quests page already shows the accepted
 * ones, so the useful half of the number to open is the half that is not
 * already on screen. This is the concrete case the registry's separate
 * `link()` builder exists for — see `DashboardMetricCatalog`. Do not "fix"
 * it to match the filter.
 */
export class ActiveQuestsMetric implements DashboardMetricResolver {
  readonly metric = "activeQuests";

  protected readonly quests = $repository(quests);
  protected readonly openQuests = $inject(OpenQuestScope);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  /**
   * ONE statement for every card on this metric, partitioned in memory.
   *
   * `resolveAll` is a batching seam and it used to loop, so the registry's
   * grouping bought nothing: N cards cost N sequential rounds of queries at
   * a D1 round trip each. Reading the union of the scopes and narrowing per
   * card afterwards costs the same one statement whether the reader pinned
   * one tile or six.
   *
   * ⚠️ The backlog gate survives the union, and that is the load-bearing
   * detail. `applyBacklogGateAcross` excludes quests whose `epicId` is in
   * the planned set of the projects it was given; an epic belongs to
   * exactly one project, so the union's planned set is precisely the union
   * of each project's own. Intersecting the rows with a card's scope
   * afterwards therefore gives the same answer as gating that scope alone.
   */
  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();

    // `inArray: []` throws, so a board whose every card resolved to an
    // empty scope must not reach the query. Each card still answers zero
    // below, on its own `projectIds.length === 0` branch.
    const union = [
      ...new Set(cards.flatMap((entry) => entry.scope.projectIds)),
    ];

    // Read the rows rather than counting twice: the footer needs the
    // new/accepted split and the link needs to know which project holds the
    // most, and both come out of the columns this one statement returns.
    const rows = union.length
      ? await this.quests.findMany({
          where: await this.openQuests.where(union),
          columns: ["projectId", "acceptedAt"],
        })
      : [];

    for (const entry of cards) {
      out.set(entry.card.id, this.resolveOne(entry, rows));
    }

    return out;
  }

  protected resolveOne(
    entry: DashboardResolvable,
    rows: Array<{ projectId: number; acceptedAt?: string }>,
  ): Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames"> {
    const { statuses } = entry.filters as ActiveQuestsFilters;
    const projectIds = entry.scope.projectIds;

    if (projectIds.length === 0) {
      return { value: 0, detail: { newCount: 0, acceptedCount: 0 } };
    }

    const scoped = new Set(projectIds);
    const wanted = new Set(statuses);
    const counted = rows.filter(
      (row) =>
        scoped.has(row.projectId) &&
        wanted.has(row.acceptedAt ? "accepted" : "new"),
    );

    const newCount = counted.filter((row) => !row.acceptedAt).length;
    const acceptedCount = counted.length - newCount;

    return {
      value: counted.length,
      detail: { newCount, acceptedCount },
      link: this.catalog.get(this.metric).link(entry.card.scope, {
        projectSlug: this.busiestProject(entry.scope.projects, counted)?.slug,
      }),
    };
  }

  /**
   * Which project the drill-through should open.
   *
   * A single-project card has one answer. An `all` card has none by
   * construction, so one is chosen deliberately — the project holding the
   * most of the number the reader just looked at, which is the one they
   * meant. Falling back to "the first project" would make the link depend on
   * row order.
   */
  protected busiestProject(
    projects: Project[],
    rows: Array<{ projectId: number }>,
  ): Project | undefined {
    if (projects.length <= 1) {
      return projects[0];
    }
    const tally = new Map<number, number>();
    for (const row of rows) {
      tally.set(row.projectId, (tally.get(row.projectId) ?? 0) + 1);
    }
    let best: Project | undefined;
    let bestCount = -1;
    for (const project of projects) {
      const count = tally.get(project.id) ?? 0;
      if (count > bestCount) {
        best = project;
        bestCount = count;
      }
    }
    return best;
  }
}
