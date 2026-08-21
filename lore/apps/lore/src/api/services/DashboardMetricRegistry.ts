import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { UserAccountToken } from "alepha/security";
import type { DashboardCardResource } from "../schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { ActiveQuestsMetric } from "./ActiveQuestsMetric.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { DashboardScopeService } from "./DashboardScopeService.ts";
import { OpenBlightsMetric } from "./OpenBlightsMetric.ts";
import { UniqueVisitorsMetric } from "./UniqueVisitorsMetric.ts";
import { UntriagedFeedbackMetric } from "./UntriagedFeedbackMetric.ts";

/**
 * Turns a whole card list into a whole list of values, in one pass.
 *
 * The computing half of the metric registry; `DashboardMetricCatalog` is the
 * declarative half, and the two are separate only because the catalogue must
 * stay importable by the browser (it generates the Add-card wizard) and this
 * one holds repositories.
 *
 * ## One request, and one query per metric
 *
 * ⚠️ Ten auto-refreshing tiles on the landing page is the exact shape of the
 * QuestGraph incident (folio #1057): a route loader revalidating once per
 * second for 51 minutes produced 4,009 identical `/api/_batch` requests from
 * a single browser tab, roughly 35% of that day's account-wide Worker
 * invocations. `/api/_batch` collapses transport, not database work — so
 * this class groups by metric before resolving, and a resolver receives
 * every card that is its own rather than being called once per card.
 *
 * There is no polling anywhere in the dashboard. "Refreshed a minute ago" is
 * a timestamp on an explicit refresh, not an interval.
 *
 * ## One failing tile costs a tile
 *
 * Cards read unrelated tables, so one metric failing while its neighbours
 * succeed is a normal state, not an exception. Every failure mode lands on
 * `ok: false` for the cards concerned:
 *
 * - the metric key is one this build does not know (a card written by a
 *   newer deploy, or a metric since removed),
 * - the scope names a project or app the caller has lost access to, or that
 *   was deleted — `DashboardScopeService` answers those with a 404 rather
 *   than an empty set, deliberately,
 * - the resolver itself threw.
 */
export class DashboardMetricRegistry {
  protected readonly log = $logger();
  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly scopes = $inject(DashboardScopeService);

  protected readonly activeQuests = $inject(ActiveQuestsMetric);
  protected readonly openBlights = $inject(OpenBlightsMetric);
  protected readonly untriagedFeedback = $inject(UntriagedFeedbackMetric);
  protected readonly uniqueVisitors = $inject(UniqueVisitorsMetric);

  /**
   * Every resolver, by metric key.
   *
   * Adding a metric is one catalogue entry, one resolver, and one line here.
   * Built from the resolvers' own `metric` fields rather than from a literal
   * map, so a resolver cannot be registered under a key it does not claim.
   */
  protected resolvers(): Map<string, DashboardMetricResolver> {
    const all: DashboardMetricResolver[] = [
      this.activeQuests,
      this.openBlights,
      this.untriagedFeedback,
      this.uniqueVisitors,
    ];
    return new Map(all.map((resolver) => [resolver.metric, resolver]));
  }

  async resolve(
    cards: DashboardCardResource[],
    user: UserAccountToken,
  ): Promise<DashboardCardValue[]> {
    const resolvers = this.resolvers();
    const values = new Map<number, DashboardCardValue>();

    // The membership set, read ONCE for the whole board. Every card's scope is
    // proven against it below; letting each card read it would run the same
    // users-to-projects join once per tile, which is the shape this endpoint
    // exists to avoid.
    const visible = await this.scopes.visibleProjects(user);

    // Group first, resolve second. Each card's scope is proven here, once —
    // a resolver never sees an id the caller may not read.
    const byMetric = new Map<string, DashboardResolvable[]>();

    for (const card of cards) {
      const descriptor = this.catalog.find(card.metric);
      if (!descriptor || !resolvers.has(card.metric)) {
        values.set(card.id, this.failed(card, []));
        continue;
      }
      if (!descriptor.scopeKinds.includes(card.scope.kind)) {
        // A card stored before the metric narrowed its accepted kinds. It
        // cannot be resolved and must not be guessed at.
        values.set(card.id, this.failed(card, []));
        continue;
      }

      try {
        const scope = await this.scopes.resolve(card.scope, user, visible);
        const group = byMetric.get(card.metric) ?? [];
        group.push({ card, scope, filters: card.filters });
        byMetric.set(card.metric, group);
      } catch (error) {
        // A project or app the caller has since lost, or one that was
        // deleted. The tile says so; the page does not care.
        this.log.debug?.(
          `Dashboard card ${card.id} has an unresolvable scope: ${String(error)}`,
        );
        values.set(card.id, this.failed(card, []));
      }
    }

    await Promise.all(
      [...byMetric].map(async ([metric, group]) => {
        try {
          const resolved = await resolvers.get(metric)!.resolveAll(group);
          for (const entry of group) {
            const value = resolved.get(entry.card.id);
            values.set(
              entry.card.id,
              value
                ? {
                    cardId: entry.card.id,
                    ok: true,
                    scopeNames: this.scopeNames(entry),
                    ...value,
                  }
                : this.failed(entry.card, this.scopeNames(entry)),
            );
          }
        } catch (error) {
          this.log.warn(
            `Dashboard metric '${metric}' failed to resolve: ${String(error)}`,
          );
          for (const entry of group) {
            values.set(
              entry.card.id,
              this.failed(entry.card, this.scopeNames(entry)),
            );
          }
        }
      }),
    );

    // Returned in the card list's own order, so the caller never has to sort
    // a response back into the layout it asked about.
    return cards.map((card) => values.get(card.id) ?? this.failed(card, []));
  }

  /**
   * The names behind a card's scope, for its first chip.
   *
   * Empty for an `all` scope: it names nothing, and what "all projects"
   * should read as is the locale's decision, not this layer's.
   */
  protected scopeNames(entry: DashboardResolvable): string[] {
    if (entry.card.scope.kind === "apps") {
      return entry.scope.sigils.map((sigil) => sigil.name);
    }
    if (entry.card.scope.kind === "projects") {
      return entry.scope.projects.map((project) => project.title);
    }
    return [];
  }

  protected failed(
    card: DashboardCardResource,
    scopeNames: string[],
  ): DashboardCardValue {
    return { cardId: card.id, ok: false, detail: {}, scopeNames };
  }
}
