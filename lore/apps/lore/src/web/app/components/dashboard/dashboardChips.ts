import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";

/**
 * The glyph a card shows where its number would be, when it has none.
 *
 * ⚠️ Not the mockup's em dash. Em dashes are banned in this repo's UI copy,
 * and the mockup carries one here (and in the Add-card blurb, which is
 * reworded in the locale files). A middle dot reads as "nothing here" without
 * looking like a subtraction.
 */
export const DASHBOARD_NO_VALUE = "·";

/**
 * The filter chips that sit next to the scope chip on a card.
 *
 * i18n keys rather than strings: the resolver returns numbers and keys and
 * never formatted copy, and this is the browser half of that split. Returns
 * an empty list for a filter set that says nothing worth a chip — an
 * `openBlights` card filtered to `open` is the default reading of the metric,
 * so a chip saying so would be noise.
 */
export const dashboardFilterChipKeys = (
  card: DashboardCardResource,
): string[] => {
  const filters = card.filters as Record<string, unknown>;

  if (card.metric === "activeQuests") {
    const statuses = (filters.statuses as string[]) ?? [];
    if (statuses.length === 2) return ["dashboard.filter.newAccepted"];
    if (statuses[0] === "new") return ["dashboard.filter.new"];
    if (statuses[0] === "accepted") return ["dashboard.filter.accepted"];
    return [];
  }

  if (card.metric === "untriagedFeedback") {
    return filters.status === "pending" ? ["dashboard.filter.untriaged"] : [];
  }

  if (card.metric === "openBlights") {
    return filters.status === "all" ? ["dashboard.filter.allStatuses"] : [];
  }

  if (card.metric === "uniqueVisitors") {
    return ["dashboard.filter.yesterday"];
  }

  return [];
};
