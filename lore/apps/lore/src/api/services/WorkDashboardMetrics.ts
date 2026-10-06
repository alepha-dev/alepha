import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { activeQuestsFiltersSchema } from "../schemas/activeQuestsFiltersSchema.ts";
import { epicProgressFiltersSchema } from "../schemas/epicProgressFiltersSchema.ts";
import { heldQuestsFiltersSchema } from "../schemas/heldQuestsFiltersSchema.ts";
import { releaseProgressFiltersSchema } from "../schemas/releaseProgressFiltersSchema.ts";
import { tagCompletionFiltersSchema } from "../schemas/tagCompletionFiltersSchema.ts";
import { untriagedFeedbackFiltersSchema } from "../schemas/untriagedFeedbackFiltersSchema.ts";

/**
 * Work's quest, epic, release, tag and feedback metrics, as the dashboard catalogue lists them, registered on core's
 * `DashboardMetricCatalog` (#E75, #Q2623).
 *
 * The declarative half only, and browser-safe like the catalogue itself: it
 * is a service of `LoreDashboardCatalog`, which both runtimes import. How a
 * metric is computed is its resolver's, server-side.
 */
export class WorkDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    this.catalog.register({
      key: "activeQuests",
      order: 10,
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
       * `todo + in_progress`, but clicking opens `status=todo` only, because the
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
              query: { status: "todo" },
            }
          : undefined,
    });

    this.catalog.register({
      key: "heldQuests",
      order: 20,
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
       * ⚠️ `?status=on_hold`, and it only decodes because
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
              query: { status: "on_hold" },
            }
          : undefined,
    });

    this.catalog.register({
      key: "epicProgress",
      order: 30,
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
    });

    this.catalog.register({
      key: "releaseProgress",
      order: 40,
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
    });

    this.catalog.register({
      key: "tagCompletion",
      order: 50,
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
       * schema already takes. The status is `todo,in_progress` - the OPEN half -
       * because the card's number is a completion ratio and the useful thing
       * to open is what is left, not what is finished.
       */
      link: (_scope, target) =>
        target.projectSlug && target.tag
          ? {
              route: "projectQuests",
              params: { projectSlug: target.projectSlug },
              query: { tag: target.tag, status: "todo,in_progress" },
            }
          : undefined,
    });

    this.catalog.register({
      key: "untriagedFeedback",
      order: 70,
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
    });
  }
}
