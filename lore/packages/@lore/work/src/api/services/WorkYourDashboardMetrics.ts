import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { dueSoonFiltersSchema } from "../schemas/dueSoonFiltersSchema.ts";
import { recentlyShippedFiltersSchema } from "../schemas/recentlyShippedFiltersSchema.ts";
import { remindersDueFiltersSchema } from "../schemas/remindersDueFiltersSchema.ts";
import { yourQuestsFiltersSchema } from "../schemas/yourQuestsFiltersSchema.ts";

/**
 * Work's "your work" tiles (#E77, #Q2655): the reader's quests, reminders and
 * due dates, and what the project shipped last. Declarative and browser-safe,
 * like `WorkDashboardMetrics`.
 *
 * `viewer`-scoped tiles are about whoever reads the board: two members open
 * the same board and each sees their own.
 */
export class WorkYourDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    const toQuests = (_scope: unknown, target: { projectSlug?: string }) =>
      target.projectSlug
        ? {
            route: "projectQuests",
            params: { projectSlug: target.projectSlug },
          }
        : undefined;
    const common = {
      boards: ["project" as const],
      group: "quests" as const,
      needs: { capability: "work" as const },
      link: toQuests,
    };

    this.catalog.register({
      ...common,
      key: "yourQuests",
      order: 11,
      labelKey: "dashboard.metric.yourQuests",
      hintKey: "dashboard.metric.yourQuests.hint",
      icon: "user-check",
      presentation: "list",
      scopeKinds: ["viewer"],
      filters: yourQuestsFiltersSchema,
    });
    this.catalog.register({
      ...common,
      key: "remindersDue",
      order: 12,
      labelKey: "dashboard.metric.remindersDue",
      hintKey: "dashboard.metric.remindersDue.hint",
      icon: "bell-ring",
      presentation: "list",
      scopeKinds: ["viewer"],
      filters: remindersDueFiltersSchema,
      needs: { capability: "work", option: "reminder" },
    });
    this.catalog.register({
      ...common,
      key: "dueSoon",
      order: 13,
      labelKey: "dashboard.metric.dueSoon",
      hintKey: "dashboard.metric.dueSoon.hint",
      icon: "calendar-clock",
      presentation: "list",
      scopeKinds: ["projects", "viewer"],
      filters: dueSoonFiltersSchema,
    });
    this.catalog.register({
      ...common,
      key: "recentlyShipped",
      order: 14,
      labelKey: "dashboard.metric.recentlyShipped",
      hintKey: "dashboard.metric.recentlyShipped.hint",
      icon: "rocket",
      presentation: "feed",
      scopeKinds: ["projects"],
      filters: recentlyShippedFiltersSchema,
    });
  }
}
