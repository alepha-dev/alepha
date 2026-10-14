import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type Sigil, sigils } from "../entities/sigils.ts";
import type { OpenBlightsFilters } from "../schemas/openBlightsFiltersSchema.ts";
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
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    // Registered by the module that owns the metric (#E75, #Q2623).
    this.dashboard.register(this);
  }

  readonly metric = "openBlights";

  protected readonly counter = $inject(OpenBlightCounter);
  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly sigils = $repository(sigils);

  /**
   * How long an app may stay quiet before its zero stops meaning "nothing
   * is wrong" and starts meaning "nobody is listening" (#Q2649).
   */
  protected readonly silentAfterDays = 30;

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();

    // The apps behind every card, once, for the data gate.
    const projectIds = [
      ...new Set(cards.flatMap((entry) => entry.scope.projectIds)),
    ];
    const apps =
      projectIds.length > 0
        ? await this.sigils.findMany({
            where: { projectId: { inArray: projectIds } },
          })
        : [];
    const since = this.dateTime
      .now()
      .subtract(this.silentAfterDays, "day")
      .toISOString();

    for (const entry of cards) {
      const { status } = entry.filters as OpenBlightsFilters;
      const result = await this.counter.count({
        projectIds: entry.scope.projectIds,
        sigilIds: entry.scope.sigilIds,
        status,
      });

      out.set(entry.card.id, {
        ...(result.count === 0
          ? this.emptyOf(this.appsOf(entry, apps), since)
          : {}),
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

  /**
   * The apps a card measures: the ones it names, or every app of its
   * projects.
   */
  protected appsOf(entry: DashboardResolvable, apps: Sigil[]): Sigil[] {
    if (entry.scope.sigilIds) {
      const named = new Set(entry.scope.sigilIds);
      return apps.filter((app) => named.has(app.id));
    }
    const projects = new Set(entry.scope.projectIds);
    return apps.filter((app) => projects.has(app.projectId));
  }

  /**
   * The data gate (#Q2649), asked only of a zero.
   *
   * ⚠️ **Never of a count above zero.** An app that went quiet with three
   * crashes still open has three things wrong, and hiding them behind
   * "silent" would be the one answer worse than a stale number. A zero is
   * different: with no app, or none that reported in 30 days, it means
   * nobody is listening, not that nothing is wrong.
   */
  protected emptyOf(
    apps: Sigil[],
    since: string,
  ): Pick<DashboardCardValue, "empty"> {
    if (apps.length === 0) return { empty: "noSigil" };
    const heard = apps.some((app) => app.lastSeenAt && app.lastSeenAt >= since);
    return heard ? {} : { empty: "silent" };
  }
}
