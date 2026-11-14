import { AlephaError } from "alepha";

import type { AdminDashboardCard } from "./AdminDashboardCard.tsx";

/**
 * One entry of the stored layout, as `alepha/api/parameters` keeps it.
 */
export interface AdminDashboardLayoutTile {
  id: string;
  enabled: boolean;
}

/**
 * A catalog card, placed by the layout: in the grid when `enabled`, in the
 * Customize picker's "Add a tile" list otherwise.
 */
export interface AdminDashboardLayoutEntry {
  card: AdminDashboardCard;
  enabled: boolean;
}

/**
 * The catalog in its code order: ascending `order`, ties kept in the order
 * they were declared. Throws on a duplicate id, since the layout addresses
 * tiles by id and two tiles sharing one would show or hide together.
 */
export const adminDashboardCatalog = (
  cards: readonly AdminDashboardCard[],
): AdminDashboardCard[] => {
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) {
      throw new AlephaError(
        `Two admin dashboard cards share the id '${card.id}'. Ids are unique across the built-in cards and AdminRouterOptions.dashboardCards.`,
      );
    }
    seen.add(card.id);
  }
  return [...cards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

/**
 * Every catalog card, in layout order, each saying whether it shows.
 *
 * 1. the layout's tiles first, in its order, each with its own `enabled`;
 * 2. a layout id the catalog no longer has is dropped;
 * 3. a catalog card the layout does not name yet is appended, shown if it is
 *    `defaultEnabled` (a new release's tile appears without an edit);
 * 4. an empty or absent layout is the code defaults: catalog order, each
 *    card shown if `defaultEnabled`.
 *
 * `can()` is not applied here: the Customize picker lists a tile the admin
 * cannot see, marked unavailable, so saving never drops another admin's
 * tile. {@link resolveAdminDashboardLayout} applies it last.
 */
export const adminDashboardLayoutEntries = (
  cards: readonly AdminDashboardCard[],
  tiles?: readonly AdminDashboardLayoutTile[],
): AdminDashboardLayoutEntry[] => {
  const catalog = adminDashboardCatalog(cards);
  const shownByDefault = (card: AdminDashboardCard) =>
    card.defaultEnabled !== false;

  if (!tiles?.length) {
    return catalog.map((card) => ({ card, enabled: shownByDefault(card) }));
  }

  const byId = new Map(catalog.map((card) => [card.id, card]));
  const placed = new Set<string>();
  const entries: AdminDashboardLayoutEntry[] = [];
  for (const tile of tiles) {
    const card = byId.get(tile.id);
    if (!card || placed.has(tile.id)) {
      continue;
    }
    placed.add(tile.id);
    entries.push({ card, enabled: tile.enabled });
  }
  for (const card of catalog) {
    if (!placed.has(card.id)) {
      entries.push({ card, enabled: shownByDefault(card) });
    }
  }
  return entries;
};

/**
 * The cards the dashboard renders, in order: the layout's shown tiles, then
 * `can()` last, so a layout never shows a tile over a missing module.
 */
export const resolveAdminDashboardLayout = (
  cards: readonly AdminDashboardCard[],
  tiles?: readonly AdminDashboardLayoutTile[],
): AdminDashboardCard[] =>
  adminDashboardLayoutEntries(cards, tiles)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.card)
    .filter((card) => (card.can ? card.can() : true));

/**
 * The layout a set of entries saves as: every catalog tile, in order, with
 * its flag. Saving the whole list (rather than the shown tiles alone) is what
 * keeps a hidden tile hidden once a release makes it `defaultEnabled`.
 */
export const adminDashboardLayoutOf = (
  entries: readonly AdminDashboardLayoutEntry[],
): { tiles: AdminDashboardLayoutTile[] } => ({
  tiles: entries.map((entry) => ({
    id: entry.card.id,
    enabled: entry.enabled,
  })),
});
