import { AlephaError } from "alepha";

import type { AdminDashboardCard } from "./AdminDashboardCard.tsx";

/**
 * The ids `AdminRouter`'s built-in cards take. An application's card may not
 * reuse one.
 */
export const ADMIN_BUILTIN_DASHBOARD_CARD_IDS = [
  "users",
  "connected",
  "failed-audits",
] as const;

/**
 * Why a set of cards cannot be the dashboard, or `undefined` when it can: two
 * cards sharing an id, which is also their React key. `builtins` are the ids
 * already taken, for an application's cards checked on their own.
 */
export const adminDashboardCardIdProblem = (
  cards: readonly { id: string }[],
  builtins: readonly string[] = ADMIN_BUILTIN_DASHBOARD_CARD_IDS,
): string | undefined => {
  const seen = new Set<string>(builtins);
  for (const card of cards) {
    if (seen.has(card.id)) {
      return `Two admin dashboard cards share the id '${card.id}'. Ids are unique across the built-in cards (${builtins.join(", ")}) and AdminRouterOptions.dashboardCards.`;
    }
    seen.add(card.id);
  }
  return undefined;
};

/**
 * Every card the code declares, ids checked unique, sorted by `order`
 * (declaration order between equals). The dashboard's tiles and their order
 * are this list and nothing stored (#Q3667).
 */
export const adminDashboardCatalog = (
  cards: readonly AdminDashboardCard[],
): AdminDashboardCard[] => {
  const problem = adminDashboardCardIdProblem(cards, []);
  if (problem) {
    throw new AlephaError(problem);
  }
  return [...cards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

/**
 * The tiles an admin sees: the catalog, each card past its own `can` gate.
 */
export const visibleAdminDashboardCards = (
  cards: readonly AdminDashboardCard[],
): AdminDashboardCard[] =>
  adminDashboardCatalog(cards).filter((card) => (card.can ? card.can() : true));
