import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { folioCardFiltersSchema } from "../schemas/folioCardFiltersSchema.ts";
import { foliosByDirectoryFiltersSchema } from "../schemas/foliosByDirectoryFiltersSchema.ts";
import { foliosThisMonthFiltersSchema } from "../schemas/foliosThisMonthFiltersSchema.ts";
import { pinnedFolioFiltersSchema } from "../schemas/pinnedFolioFiltersSchema.ts";
import { recentFoliosFiltersSchema } from "../schemas/recentFoliosFiltersSchema.ts";

/**
 * Knowledge's first dashboard metrics (#E77, #Q2658): before them a
 * knowledge-only project had no tile at all.
 * Declarative and browser-safe; injected by `LoreRememberApi` and
 * `LoreRememberWeb`. All `needs: knowledge`.
 */
export class KnowledgeDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    const toFolios = (_scope: unknown, target: { projectSlug?: string }) =>
      target.projectSlug
        ? {
            route: "projectFolios",
            params: { projectSlug: target.projectSlug },
          }
        : undefined;
    const common = {
      boards: ["project" as const],
      group: "knowledge" as const,
      scopeKinds: ["projects" as const],
      needs: { capability: "remember" as const },
      link: toFolios,
    };

    this.catalog.register({
      ...common,
      key: "pinnedFolio",
      order: 91,
      labelKey: "dashboard.metric.pinnedFolio",
      hintKey: "dashboard.metric.pinnedFolio.hint",
      icon: "pin",
      presentation: "note",
      filters: pinnedFolioFiltersSchema,
    });
    this.catalog.register({
      ...common,
      key: "recentFolios",
      order: 92,
      labelKey: "dashboard.metric.recentFolios",
      hintKey: "dashboard.metric.recentFolios.hint",
      icon: "file-clock",
      presentation: "feed",
      filters: recentFoliosFiltersSchema,
    });
    this.catalog.register({
      ...common,
      key: "foliosThisMonth",
      order: 93,
      labelKey: "dashboard.metric.foliosThisMonth",
      hintKey: "dashboard.metric.foliosThisMonth.hint",
      icon: "file-plus",
      presentation: "list",
      filters: foliosThisMonthFiltersSchema,
    });
    // A piece of the project's knowledge on the board (#E144, #Q3520): a
    // folio the person points the card at, as a note, a table's first rows,
    // or what comes next. Its presentation follows the folio, so the value
    // names it (`DashboardCardValue.presentation`); `note` is the default.
    this.catalog.register({
      ...common,
      key: "folio",
      order: 90,
      labelKey: "dashboard.metric.folio",
      hintKey: "dashboard.metric.folio.hint",
      icon: "file-text",
      presentation: "note",
      filters: folioCardFiltersSchema,
      requires: "folio:read",
      defaultSize: { size: 2, height: 2 },
    });
    this.catalog.register({
      ...common,
      key: "foliosByDirectory",
      order: 94,
      labelKey: "dashboard.metric.foliosByDirectory",
      hintKey: "dashboard.metric.foliosByDirectory.hint",
      icon: "folder-tree",
      presentation: "progress",
      filters: foliosByDirectoryFiltersSchema,
    });
  }
}
