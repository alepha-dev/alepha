import { $inject } from "alepha";

import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import type { OpenBlightsFilters } from "../schemas/openBlightsFiltersSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { OpenBlightCounter } from "./OpenBlightCounter.ts";

/**
 * The crash inbox at a glance: distinct open bugs, with occurrences and app
 * count in the footer.
 *
 * The counting is all in `OpenBlightCounter`, which is where the hard part
 * lives — `blights.sigilId` is *last reporter* and cannot answer "how many
 * open blights do apps [A, B] have" without moving whenever an unrelated app
 * reports the same bug.
 *
 * ## The headline stays the bug count
 *
 * `312 occurrences` is a far larger and more volatile number than `4 open
 * blights`, and it is the less useful one: occurrences say how loud a crash
 * loop is, the bug count says how many things are wrong. The footer is the
 * right place for it, and the two must not swap.
 *
 * ## Blights outlive their apps
 *
 * `blights.sigilId` is `ON DELETE SET NULL` and rows survive their reporter,
 * so an owner who deletes their last app still has an inbox full of open
 * crashes. A card scoped to apps inherits that: deleting a selected app
 * makes the card's scope name something that no longer exists, and
 * `DashboardScopeService` answers that with a 404, which surfaces as a
 * degraded tile saying so. It deliberately does NOT silently drop to zero
 * the moment a token is revoked — a zero would read as "nothing is wrong".
 */
export class OpenBlightsMetric implements DashboardMetricResolver {
  readonly metric = "openBlights";

  protected readonly counter = $inject(OpenBlightCounter);
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
      const { status } = entry.filters as OpenBlightsFilters;
      const result = await this.counter.count({
        projectIds: entry.scope.projectIds,
        sigilIds: entry.scope.sigilIds,
        status,
      });

      out.set(entry.card.id, {
        value: result.count,
        detail: { occurrences: result.occurrences, apps: result.apps },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: entry.scope.projects.find(
            (project) => project.id === result.topProjectId,
          )?.slug,
        }),
      });
    }

    return out;
  }
}
