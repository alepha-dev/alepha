import { $inject } from "alepha";

import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import type { TagCompletionFilters } from "../schemas/tagCompletionFiltersSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { QuestTagTallyService } from "./QuestTagTallyService.ts";

/**
 * How much of the work carrying one tag is done.
 *
 * "A dashboard to see completion percentage by tag" was the first thing
 * Thibaut asked for. On a board of numbers that is one card per tag you care
 * about, not a chart.
 *
 * Tags are the right axis: `quests.tags` labels the **nature** of the work and
 * is orthogonal to `area`, which labels the module, so this answers a question
 * no existing surface did.
 *
 * ## The aggregation is the one Reports shipped
 *
 * `QuestTagTallyService` holds the fold and the defensive `parseTags`, and
 * Reports ▸ Quests reads the same methods. There is no second tally, and
 * there could be no SQL one: no `GROUP BY` reaches inside a JSON array in a
 * text column.
 *
 * ## ⚠️ A quest carrying two tags counts in both
 *
 * So the per-tag numbers do not partition the project. Reports says so in a
 * line under its heading and its e2e asserts that line; a single-tag card
 * hides the overlap entirely unless it says so, which is what its hint does.
 */
export class TagCompletionMetric implements DashboardMetricResolver {
  readonly metric = "tagCompletion";

  protected readonly tags = $inject(QuestTagTallyService);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  /**
   * ONE row read for every tag card on the board, folded per card.
   *
   * Three cards on three tags is one query, which is the whole reason
   * `resolveAll` takes a list.
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

    const union = [
      ...new Set(cards.flatMap((entry) => entry.scope.projectIds)),
    ];
    const rows = await this.tags.rowsFor(union);

    for (const entry of cards) {
      const { tag } = entry.filters as TagCompletionFilters;
      const projectIds = new Set(entry.scope.projectIds);
      const scoped = rows.filter((row) => projectIds.has(row.projectId));
      const counts = this.tags.tally(scoped).get(tag) ?? {
        completed: 0,
        remaining: 0,
      };
      const total = counts.completed + counts.remaining;

      out.set(entry.card.id, {
        // No quest carries this tag: there is no percentage to show, and a 0%
        // would read as "none of it is done" rather than "there is none".
        value:
          total > 0 ? Math.round((counts.completed / total) * 100) : undefined,
        detail: {
          tag,
          completed: counts.completed,
          remaining: counts.remaining,
          total,
        },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: entry.scope.projects[0]?.slug,
          tag,
        }),
      });
    }

    return out;
  }
}
