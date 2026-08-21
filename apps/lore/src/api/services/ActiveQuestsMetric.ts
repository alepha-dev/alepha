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

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();

    for (const entry of cards) {
      out.set(entry.card.id, await this.resolveOne(entry));
    }

    return out;
  }

  protected async resolveOne(
    entry: DashboardResolvable,
  ): Promise<Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">> {
    const { statuses } = entry.filters as ActiveQuestsFilters;
    const projectIds = entry.scope.projectIds;

    if (projectIds.length === 0) {
      return { value: 0, detail: { newCount: 0, acceptedCount: 0 } };
    }

    const where = await this.openQuests.where(projectIds);

    // Read the rows rather than counting twice: the footer needs the
    // new/accepted split and the link needs to know which project holds the
    // most, and both come out of the columns this one statement returns.
    const rows = await this.quests.findMany({
      where,
      columns: ["projectId", "acceptedAt"],
    });

    const wanted = new Set(statuses);
    const counted = rows.filter((row) =>
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
