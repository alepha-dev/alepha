import { AlephaError, type ZType } from "alepha";

import { activeQuestsFiltersSchema } from "../schemas/activeQuestsFiltersSchema.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import type {
  DashboardScope,
  DashboardScopeKind,
} from "../schemas/dashboardScopeSchema.ts";
import { epicProgressFiltersSchema } from "../schemas/epicProgressFiltersSchema.ts";
import { heldQuestsFiltersSchema } from "../schemas/heldQuestsFiltersSchema.ts";
import { openBlightsFiltersSchema } from "../schemas/openBlightsFiltersSchema.ts";
import { releaseProgressFiltersSchema } from "../schemas/releaseProgressFiltersSchema.ts";
import { tagCompletionFiltersSchema } from "../schemas/tagCompletionFiltersSchema.ts";
import { uniqueVisitorsFiltersSchema } from "../schemas/uniqueVisitorsFiltersSchema.ts";
import { untriagedFeedbackFiltersSchema } from "../schemas/untriagedFeedbackFiltersSchema.ts";

/**
 * Which board a metric may be offered on.
 *
 * `home` is the signed-in landing page: per user, cross-project, and the only
 * board that existed before epic #E46. `project` is a project's own board,
 * shared by everyone in it and reached at the project root.
 *
 * ⚠️ **Where a metric may be OFFERED, which is not what a card POINTS at.**
 * A project-board card that points at the project stores
 * `kind: "projects", projectIds: [thisProject]`, forced by the controller
 * rather than chosen by the reader, so the four existing resolvers,
 * `assertWellFormed`, `narrow()` and `ResolvedDashboardScope` all keep
 * working untouched. A `self` scope kind would have needed a branch in every
 * one of them for a value that is always the same.
 */
export type DashboardBoard = "home" | "project";

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
  /**
   * The epic's per-project `number`, for an `epic` scope.
   *
   * ⚠️ **Not the id the scope stores.** `projectEpic` is `/epics/:epicNumber`
   * and `dashboardScopeSchema.epicId` is a row id, so the two are different
   * integers and a card that confused them would land on somebody else's
   * epic without erroring. `link()` is pure and receives only the scope and
   * this target, so the resolver is the only layer that can carry the
   * translation across — `DashboardScopeService` reads the row.
   */
  epicNumber?: number;
  /**
   * The release's `tag`, for a `release` scope. Same trap as
   * {@link epicNumber}: `projectRelease` is `/releases/:releaseTag`, because
   * `/alepha/releases/0.28.0` is what the URL is for, and the scope stores an
   * id. Absent for a release with no tag, which the column permits.
   */
  releaseTag?: string;
  /**
   * The tag a `tagCompletion` card is narrowed to.
   *
   * ⚠️ On the TARGET rather than read off the scope, because it is a FILTER
   * and `link()` only receives the scope and this. It is the one drill-through
   * value that comes from `filters` instead of from a resolved row.
   */
  tag?: string;
}

/**
 * The capability a metric's number comes from.
 *
 * ⚠️ **Per scope target, not per board.** This is the HOME dashboard: a card
 * is scoped to `all`, to some projects, or to some apps. So the requirement
 * is checked against each candidate target - a project is offered when IT has
 * the capability, an app when ITS project does, and `all` when any project
 * the reader belongs to does. A single board-wide answer would either hide a
 * card the reader has one good project for, or offer one that can only ever
 * say zero.
 *
 * `option` is why this lives here rather than only on
 * `CapabilityRegistry.dashboardCards`, which is a flat list of keys per
 * capability: blights and visitors both need Apps **with tracking on**, since
 * Apps without it is a project that deploys and does not watch. The two
 * declarations are pinned to each other by
 * `test/dashboard-capabilities.spec.ts`.
 */
export interface DashboardMetricRequirement {
  capability: CapabilityKey;
  option?: string;
}

/**
 * One entry in the metric registry.
 *
 * Declares everything the rest of the system needs to know about a metric
 * except how to compute it: the server resolver is a separate class, because
 * it holds repositories and this file must stay importable by the browser.
 */
export interface DashboardMetricDescriptor {
  /**
   * Registry key, and the value stored in `dashboard_cards.metric`.
   */
  key: string;
  /**
   * The boards this metric may be offered on.
   *
   * Required rather than defaulted, so a metric added tomorrow decides where
   * it belongs instead of inheriting an answer. The four v1 metrics are
   * `["home"]`, which is what keeps home exactly as it was.
   */
  boards: DashboardBoard[];
  /**
   * Catalogue section in the Add-card panel.
   */
  group: "quests" | "epics" | "inbox" | "apps";
  /**
   * i18n key for the catalogue row.
   */
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
  /**
   * i18n key for the one-line hint under the catalogue row.
   */
  hintKey: string;
  /**
   * lucide-react icon name, as the mockup names it.
   */
  icon: string;
  presentation: DashboardPresentation;
  /**
   * The scope kinds this metric accepts. A card whose scope kind is absent
   * here is invalid by construction — visitors take `apps`, never `epic`;
   * active quests take `projects`, never `apps`.
   */
  scopeKinds: DashboardScopeKind[];
  /**
   * This metric's own filter vocabulary.
   */
  filters: ZType;
  /**
   * Where a filter field's options come from, when the schema cannot say.
   *
   * ⚠️ Only for values that are ROWS rather than a build-time enum. A
   * project's tags are the case: the schema types the field as text, and a
   * free-text box would let somebody type a tag that does not exist and get a
   * permanent zero. Naming the source here keeps the wizard generated - the
   * step reads this and fills the options - rather than special-casing a
   * metric key in a component, which is the property the panel's docblock
   * asks for.
   */
  filterSources?: Record<string, "projectTags">;
  /**
   * The capability, and optionally the option, a target must have for this
   * metric to mean anything there. Every v1 metric has one; the field is
   * optional so a future Core metric (something about members, say) needs no
   * placeholder.
   */
  needs?: DashboardMetricRequirement;
  /**
   * Additionally: the app must report page views.
   *
   * Separate from {@link needs} because it is a property of the APP rather
   * than of its project - two apps in the same tracking project can disagree
   * about it, and a beacon-less app's analytics page 404s outright
   * (`assertBeacon`), so a visitors card scoped to one would show a permanent
   * zero and link to an error. Declared here rather than as
   * `metric.key === "uniqueVisitors"` in two components, which is what it was.
   */
  needsBeacon?: boolean;
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
      /**
       * ⚠️ On BOTH boards, and the project half is what makes `heldQuests`
       * legible: "Quests 12 / On hold 3" reads as three of the twelve being
       * stuck only while both numbers are on screen and come from the same
       * `OpenQuestScope`. Home is unchanged - inside a project the scope step
       * is skipped and the controller forces `projects: [thisProject]`.
       */
      boards: ["home", "project"],
      group: "quests",
      labelKey: "dashboard.metric.activeQuests",
      hintKey: "dashboard.metric.activeQuests.hint",
      icon: "grid-3x3",
      presentation: "scalar",
      scopeKinds: ["projects", "all"],
      filters: activeQuestsFiltersSchema,
      needs: { capability: "work" },
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
      key: "heldQuests",
      /**
       * Project only. A held count across every project the reader belongs to
       * answers nobody's question: a hold is somebody waiting on somebody in
       * one project, and the drill-through is one project's quest list.
       */
      boards: ["project"],
      group: "quests",
      labelKey: "dashboard.metric.heldQuests",
      hintKey: "dashboard.metric.heldQuests.hint",
      icon: "circle-pause",
      presentation: "scalar",
      scopeKinds: ["projects"],
      filters: heldQuestsFiltersSchema,
      needs: { capability: "work" },
      /**
       * ⚠️ `?status=held`, and it only decodes because
       * `boardFiltersSchema.status` is derived from `questStatusSchema`
       * (#Q2082). Before that fix the value was silently dropped and the link
       * degraded to the unfiltered list, which is the failure this drill-
       * through would otherwise repeat.
       */
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectQuests",
              params: { projectSlug: target.projectSlug },
              query: { status: "held" },
            }
          : undefined,
    },
    {
      key: "epicProgress",
      /**
       * ⚠️ The `epics` group has existed in this catalogue since epic #E4
       * with nothing in it, and `dashboardScopeSchema` has carried
       * `kind: "epic"` since then commented "reserved for the deferred
       * epic-progress tile". This is the entry both were waiting for.
       */
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.epicProgress",
      hintKey: "dashboard.metric.epicProgress.hint",
      icon: "layers",
      presentation: "progress",
      scopeKinds: ["epic"],
      filters: epicProgressFiltersSchema,
      /**
       * The OPTION as well as the capability. `CapabilityRegistry`'s list is
       * flat and can only say `work`, which is exactly why `needs` exists:
       * a project that does Work without epics has no epic to point at.
       */
      needs: { capability: "work", option: "epics" },
      /**
       * ⚠️ `epicNumber`, filled by the resolver from the row the scope
       * proved. `projectEpic` is `/epics/:epicNumber` and the scope stores
       * `epicId`; the two are different integers and confusing them lands on
       * a real page showing the wrong epic.
       */
      link: (_scope, target) =>
        target.projectSlug && target.epicNumber !== undefined
          ? {
              route: "projectEpic",
              params: {
                projectSlug: target.projectSlug,
                epicNumber: String(target.epicNumber),
              },
            }
          : undefined,
    },
    {
      key: "releaseProgress",
      /**
       * The companion to the epic card, on the second scope kind
       * `dashboardScopeSchema` reserved in #E4 and no metric ever accepted.
       */
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.releaseProgress",
      hintKey: "dashboard.metric.releaseProgress.hint",
      icon: "flag",
      presentation: "progress",
      scopeKinds: ["release"],
      filters: releaseProgressFiltersSchema,
      needs: { capability: "work", option: "releases" },
      /**
       * ⚠️ By TAG, not by id. `projectRelease` is `/releases/:releaseTag`
       * because `/alepha/releases/0.28.0` is what the URL is for, and the
       * scope stores `releaseId`. A release with no tag has no destination
       * and the card is inert rather than linking to `/releases/undefined`.
       */
      link: (_scope, target) =>
        target.projectSlug && target.releaseTag
          ? {
              route: "projectRelease",
              params: {
                projectSlug: target.projectSlug,
                releaseTag: target.releaseTag,
              },
            }
          : undefined,
    },
    {
      key: "tagCompletion",
      boards: ["project"],
      group: "quests",
      labelKey: "dashboard.metric.tagCompletion",
      hintKey: "dashboard.metric.tagCompletion.hint",
      icon: "flame",
      presentation: "progress",
      /**
       * The PROJECT, not the tag. A tag is not a thing a card points at; it
       * is how the card narrows what it counts, which is what `filters` is.
       */
      scopeKinds: ["projects"],
      filters: tagCompletionFiltersSchema,
      filterSources: { tag: "projectTags" },
      needs: { capability: "work" },
      /**
       * ⚠️ `?tag=` AND `?status=`, both of which the quests page's query
       * schema already takes. The status is `new,accepted` - the OPEN half -
       * because the card's number is a completion ratio and the useful thing
       * to open is what is left, not what is finished.
       */
      link: (_scope, target) =>
        target.projectSlug && target.tag
          ? {
              route: "projectQuests",
              params: { projectSlug: target.projectSlug },
              query: { tag: target.tag, status: "new,accepted" },
            }
          : undefined,
    },
    {
      key: "openBlights",
      boards: ["home"],
      group: "inbox",
      labelKey: "dashboard.metric.openBlights",
      hintKey: "dashboard.metric.openBlights.hint",
      icon: "bug",
      presentation: "scalar",
      scopeKinds: ["apps", "projects", "all"],
      filters: openBlightsFiltersSchema,
      /**
       * `apps.track`, not bare `apps`. Blights arrive on the same ingest
       * path the option governs, so a project that deploys without watching
       * has no source for this number.
       */
      needs: { capability: "apps", option: "track" },
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
      boards: ["home"],
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
      needs: { capability: "support" },
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
      boards: ["home"],
      group: "apps",
      labelKey: "dashboard.metric.uniqueVisitors",
      hintKey: "dashboard.metric.uniqueVisitors.hint",
      icon: "users",
      presentation: "scalar",
      scopeKinds: ["apps", "projects"],
      filters: uniqueVisitorsFiltersSchema,
      needs: { capability: "apps", option: "track" },
      needsBeacon: true,
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

  /**
   * Every metric, catalogue order.
   */
  all(): DashboardMetricDescriptor[] {
    return this.metrics;
  }

  /**
   * Every metric one board may offer, catalogue order.
   *
   * The Add-card panel reads this rather than {@link all}, so a metric that
   * only means something inside a project never appears on home and the four
   * cross-project ones never appear on a project board.
   */
  on(board: DashboardBoard): DashboardMetricDescriptor[] {
    return this.metrics.filter((metric) => metric.boards.includes(board));
  }

  /**
   * Whether this metric may be offered on this board at all.
   */
  offers(key: string, board: DashboardBoard): boolean {
    return this.find(key)?.boards.includes(board) ?? false;
  }

  /**
   * One metric, or `undefined` for a key this build does not know.
   */
  find(key: string): DashboardMetricDescriptor | undefined {
    return this.metrics.find((metric) => metric.key === key);
  }

  /**
   * One metric, or a thrown error. Use where an unknown key is a bug.
   */
  get(key: string): DashboardMetricDescriptor {
    const metric = this.find(key);
    if (!metric) {
      throw new AlephaError(`Unknown dashboard metric: ${key}`);
    }
    return metric;
  }

  /**
   * Whether this metric can be pointed at this kind of thing, on this board.
   *
   * ⚠️ **The board is not optional, and that is the point.** A metric offered
   * only on home must not become storable on a project board because a caller
   * forgot which board it was validating for, and the two boards genuinely
   * differ about `projects` and `all`: inside a project the route IS the
   * project, so both are server-forced rather than chosen.
   */
  accepts(
    key: string,
    kind: DashboardScopeKind,
    board: DashboardBoard,
  ): boolean {
    if (!this.offers(key, board)) {
      return false;
    }
    return this.find(key)?.scopeKinds.includes(kind) ?? false;
  }

  /**
   * The scope kinds a READER may pick from, for this metric on this board.
   *
   * Not the same list as `scopeKinds`, and the difference is what makes the
   * Add-card wizard skip a step rather than render a picker with one answer:
   * on a project board `projects` and `all` both mean "this project", which
   * the controller forces, so neither is something to choose. What is left is
   * an app, an epic or a release — genuinely several answers.
   */
  pickableScopeKinds(key: string, board: DashboardBoard): DashboardScopeKind[] {
    const kinds = this.find(key)?.scopeKinds ?? [];
    if (board === "home") {
      return kinds;
    }
    return kinds.filter((kind) => kind !== "all" && kind !== "projects");
  }

  /**
   * The scope a card gets when the reader was never asked.
   *
   * On a project board a metric with nothing to point at is stored against
   * the project itself, as an ordinary `projects` scope carrying the route's
   * single id. `undefined` when the reader does have a choice to make.
   */
  forcedScope(
    key: string,
    board: DashboardBoard,
    projectId: number,
  ): DashboardScope | undefined {
    if (board !== "project") {
      return undefined;
    }
    if (this.pickableScopeKinds(key, board).length > 0) {
      return undefined;
    }
    return { kind: "projects", projectIds: [projectId] };
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
