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
/**
 * The chips that are literal text rather than an i18n key.
 *
 * One case, and it is the reason this exists rather than being folded into
 * {@link dashboardFilterChipKeys}: a tag card's chip is the TAG, which is the
 * reader's own word and the only thing telling two tag cards apart. Every
 * other chip is a key, because the resolver returns numbers and keys and
 * never formatted copy.
 */
export const dashboardFilterChipLabels = (
  card: DashboardCardResource,
): string[] => {
  if (card.metric === "tagCompletion") {
    const tag = (card.filters as Record<string, unknown>).tag;
    return typeof tag === "string" && tag.length > 0 ? [tag] : [];
  }
  return [];
};

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

  if (card.metric === "tagCompletion") {
    // ⚠️ Deliberately NOT an i18n key: the tag is the reader's own text, and
    // it is the only thing distinguishing two tag cards on the same board.
    // `dashboardFilterChipKeys` answers keys, so this one is handled where
    // the card renders its chips instead - see `DashboardCard`.
    return [];
  }

  if (card.metric === "uniqueVisitors") {
    return ["dashboard.filter.yesterday"];
  }

  return [];
};
