import { AlephaError, type ZType } from "alepha";

import { activeQuestsFiltersSchema } from "../schemas/activeQuestsFiltersSchema.ts";
import type {
  DashboardScope,
  DashboardScopeKind,
} from "../schemas/dashboardScopeSchema.ts";
import { openBlightsFiltersSchema } from "../schemas/openBlightsFiltersSchema.ts";
import { uniqueVisitorsFiltersSchema } from "../schemas/uniqueVisitorsFiltersSchema.ts";
import { untriagedFeedbackFiltersSchema } from "../schemas/untriagedFeedbackFiltersSchema.ts";

/**
 * How a card renders its value. Taken from the mockup, which shows all four.
 * Only `scalar` is used by the v1 metrics; the other three exist so the
 * deferred tiles (epic progress, page views with a sparkline, needs
 * attention) slot in as a registry entry rather than as a new field.
 */
export type DashboardPresentation = "scalar" | "trend" | "progress" | "list";

/**
 * Where clicking a card goes.
 *
 * A route NAME plus params, not a URL: the names are `$page` keys from
 * `AppRouter`, so the browser hands this straight to `router.push`.
 *
 * ⚠️ Route names are plain strings here and a `$page` rename is not
 * typecheck-protected (see `apps/lore/CLAUDE.md`). `dashboard-links.spec.ts`
 * asserts every name below still exists on `AppRouter`.
 */
export interface DashboardCardLink {
  route: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

/**
 * What a resolver learned about *where* the number came from, so `link()`
 * can point at something that exists.
 *
 * A card scoped to `all` has no single destination by construction, so the
 * resolver picks one deliberately (the project contributing the most to the
 * number) and reports it here rather than letting the choice fall out of the
 * code.
 */
export interface DashboardCardTarget {
  projectSlug?: string;
  appName?: string;
}

/**
 * One entry in the metric registry.
 *
 * Declares everything the rest of the system needs to know about a metric
 * except how to compute it: the server resolver is a separate class, because
 * it holds repositories and this file must stay importable by the browser.
 */
export interface DashboardMetricDescriptor {
  /** Registry key, and the value stored in `dashboard_cards.metric`. */
  key: string;
  /** Catalogue section in the Add-card panel. */
  group: "quests" | "epics" | "inbox" | "apps";
  /** i18n key for the catalogue row. */
  labelKey: string;
  /**
   * i18n key for the card's own header, when it differs from the catalogue
   * row's. The catalogue names the metric ("Untriaged feedback"); the card
   * only has to name itself, inside a tile whose chips already say the rest
   * ("Feedback", above an `untriaged` chip). The mockup makes the same split.
   *
   * Optional: most metrics read the same in both places.
   */
  cardLabelKey?: string;
  /** i18n key for the one-line hint under the catalogue row. */
  hintKey: string;
  /** lucide-react icon name, as the mockup names it. */
  icon: string;
  presentation: DashboardPresentation;
  /**
   * The scope kinds this metric accepts. A card whose scope kind is absent
   * here is invalid by construction — visitors take `apps`, never `epic`;
   * active quests take `projects`, never `apps`.
   */
  scopeKinds: DashboardScopeKind[];
  /** This metric's own filter vocabulary. */
  filters: ZType;
  /**
   * Where clicking goes.
   *
   * ⚠️ **Drill-through is configuration, not derivation.** `link()` is
   * deliberately allowed to disagree with the count — see `activeQuests`
   * below, which counts `new + accepted` and navigates to `status=new`. A
   * generic filter-to-query-string translation would land on the wrong list.
   */
  link: (
    scope: DashboardScope,
    target: DashboardCardTarget,
  ) => DashboardCardLink | undefined;
}

/**
 * The closed set of metrics a dashboard card can show.
 *
 * This is the declarative half of the metric registry: label, presentation,
 * accepted scope kinds, filter schema and drill-through. The computing half
 * — one resolver class per metric — lives in `DashboardMetricRegistry`,
 * which holds repositories.
 *
 * ⚠️ **Browser-safe on purpose.** The Add-card wizard is generated from this
 * class, so it is injected on both sides. It must never gain a
 * `$repository`, a `$inject` of a server service, or an import that pulls
 * one in.
 *
 * Adding a metric is: one entry here, one resolver, one pair of i18n keys.
 */
export class DashboardMetricCatalog {
  /**
   * Every metric, in the order the Add-card panel lists them (grouped, and
   * within a group as written).
   */
  protected readonly metrics: DashboardMetricDescriptor[] = [
    {
      key: "activeQuests",
      group: "quests",
      labelKey: "dashboard.metric.activeQuests",
      hintKey: "dashboard.metric.activeQuests.hint",
      icon: "grid-3x3",
      presentation: "scalar",
      scopeKinds: ["projects", "all"],
      filters: activeQuestsFiltersSchema,
      /**
       * ⚠️ Deliberately disagrees with the count. The tile counts
       * `new + accepted`, but clicking opens `status=new` only, because the
       * questlog rail on the left of the quests page already shows the
       * accepted ones — so the useful thing to open is the half of the
       * number that is not already on screen. Do not "fix" this to match
       * the filter.
       */
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectQuests",
              params: { projectSlug: target.projectSlug },
              query: { status: "new" },
            }
          : undefined,
    },
    {
      key: "openBlights",
      group: "inbox",
      labelKey: "dashboard.metric.openBlights",
      hintKey: "dashboard.metric.openBlights.hint",
      icon: "bug",
      presentation: "scalar",
      scopeKinds: ["apps", "projects", "all"],
      filters: openBlightsFiltersSchema,
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectBlights",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    },
    {
      key: "untriagedFeedback",
      group: "inbox",
      labelKey: "dashboard.metric.untriagedFeedback",
      cardLabelKey: "dashboard.metric.untriagedFeedback.card",
      hintKey: "dashboard.metric.untriagedFeedback.hint",
      icon: "inbox",
      presentation: "scalar",
      /**
       * No `apps` kind, and that is a decision rather than an omission: no
       * flow can attribute a feedback item to an app. Nothing writes
       * `source.sigilId`, and the sigil feedback URL contract carries no app
       * identifier — so an app-scoped card would count nothing, forever.
       */
      scopeKinds: ["projects", "all"],
      filters: untriagedFeedbackFiltersSchema,
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectFeedback",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    },
    {
      key: "uniqueVisitors",
      group: "apps",
      labelKey: "dashboard.metric.uniqueVisitors",
      hintKey: "dashboard.metric.uniqueVisitors.hint",
      icon: "users",
      presentation: "scalar",
      scopeKinds: ["apps", "projects"],
      filters: uniqueVisitorsFiltersSchema,
      /**
       * The analytics tab 404s when the app's own `kinds` lacks `beacon`
       * (`assertBeacon`), so the resolver only ever reports an app that
       * carries it. With no such app there is no destination and the card
       * is not clickable, which is the honest answer.
       */
      link: (_scope, target) =>
        target.projectSlug && target.appName
          ? {
              route: "appAnalytics",
              params: {
                projectSlug: target.projectSlug,
                appName: target.appName,
              },
            }
          : undefined,
    },
  ];

  /** Every metric, catalogue order. */
  all(): DashboardMetricDescriptor[] {
    return this.metrics;
  }

  /** One metric, or `undefined` for a key this build does not know. */
  find(key: string): DashboardMetricDescriptor | undefined {
    return this.metrics.find((metric) => metric.key === key);
  }

  /** One metric, or a thrown error. Use where an unknown key is a bug. */
  get(key: string): DashboardMetricDescriptor {
    const metric = this.find(key);
    if (!metric) {
      throw new AlephaError(`Unknown dashboard metric: ${key}`);
    }
    return metric;
  }

  /** Whether this metric can be pointed at this kind of thing. */
  accepts(key: string, kind: DashboardScopeKind): boolean {
    return this.find(key)?.scopeKinds.includes(kind) ?? false;
  }

  /**
   * Filter values as the metric understands them, defaults filled in.
   *
   * Throws on a shape the metric does not recognise. Callers that read a
   * stored card decide whether that is fatal (a write) or a reason to fall
   * back to defaults (a read) — see `DashboardCardService.readFilters`.
   */
  parseFilters(key: string, filters: unknown): Record<string, unknown> {
    return this.get(key).filters.parse(filters ?? {}) as Record<
      string,
      unknown
    >;
  }

  /**
   * The default filter values of a metric — what an Add-card wizard starts
   * from, and what a card with unreadable stored filters degrades to.
   */
  defaultFilters(key: string): Record<string, unknown> {
    return this.parseFilters(key, {});
  }
}
