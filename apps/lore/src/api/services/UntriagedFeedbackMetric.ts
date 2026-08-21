import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { feedback } from "../entities/feedback.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import type { UntriagedFeedbackFilters } from "../schemas/untriagedFeedbackFiltersSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";

/**
 * The triage queue: how much feedback is waiting, and how long the oldest
 * has been waiting.
 *
 * ## The footer is the more actionable half
 *
 * A count of 2 that has been sitting for a month reads very differently from
 * a count of 12 filed this morning, so "oldest waiting N days" is not
 * decoration. It comes from `DateTimeProvider`, never `Date.now()`, which is
 * what makes it assertable under `travel()`.
 *
 * ## No app scope, and that is a decision
 *
 * `feedback` has no `sigilId`, and nothing can supply one: no ingest path
 * knows which app a submission came from (the sigil feedback URL contract
 * carries no app identifier, and `source.sigilId` is attacker-controlled
 * provenance that nothing ever writes). An app-scoped card would count
 * nothing, forever — so the metric does not accept the scope kind at all
 * rather than offering one that is quietly always zero.
 *
 * ⚠️ Status values here are `pending` / `accepted` / `rejected`, not the
 * quest lifecycle's. The mockup's "untriaged" chip is `pending`.
 */
export class UntriagedFeedbackMetric implements DashboardMetricResolver {
  readonly metric = "untriagedFeedback";

  protected readonly feedback = $repository(feedback);
  protected readonly dateTime = $inject(DateTimeProvider);
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
    const { status } = entry.filters as UntriagedFeedbackFilters;
    const projectIds = entry.scope.projectIds;

    if (projectIds.length === 0) {
      return { value: 0, detail: {} };
    }

    const rows = await this.feedback.findMany({
      where: {
        projectId: { inArray: projectIds },
        // A soft-deleted item is not waiting for anyone. The repository
        // applies this itself for `deletedAt` entities, but the inbox and
        // this count must agree and saying so costs nothing.
        deletedAt: { isNull: true },
        ...(status === "pending" ? { status: { eq: "pending" } } : {}),
      },
      columns: ["projectId", "createdAt"],
    });

    if (rows.length === 0) {
      return { value: 0, detail: {} };
    }

    const oldest = rows.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    const oldestWaitingDays = Math.floor(
      (this.dateTime.nowMillis() - new Date(oldest.createdAt).getTime()) /
        (24 * 60 * 60 * 1000),
    );

    return {
      value: rows.length,
      detail: { oldestWaitingDays },
      // The project holding the oldest item, not the busiest one: this is a
      // queue, and the thing a reader clicking a "waiting 30 days" footer
      // wants opened is the inbox that footer is about. There is no
      // cross-project inbox, so the choice has to be made rather than fall
      // out of the code. `ProjectFeedback` already defaults its filter to
      // `pending`, so a plain navigation lands right with no URL param.
      link: this.catalog.get(this.metric).link(entry.card.scope, {
        projectSlug: entry.scope.projects.find(
          (project) => project.id === oldest.projectId,
        )?.slug,
      }),
    };
  }
}
