import type { ReactNode } from "react";

/**
 * One tile on the admin dashboard.
 *
 * ### Gate on an action, never on a permission
 *
 * `can` mirrors the rule the sidebar already applies to nav entries: a card
 * whose backing module was never registered does not render at all, rather
 * than rendering an error or a misleading zero. Gate on an **action**
 * (`someApi.someAction.can()`), not on a permission name — a permission
 * declared by a page's own `$secure` is granted to a `*` wildcard holder
 * whether or not any controller backs it, so a permission check would leave a
 * card standing over a dead API.
 *
 * The card carries no title of its own: `render` owns its whole surface,
 * because a stat tile, a chart and a table of recent rows have nothing useful
 * in common above the card boundary.
 */
export interface AdminDashboardCard {
  /**
   * Stable identity, also the React key. Must be unique across the built-in
   * cards and the application's own.
   */
  id: string;

  /**
   * Sort position, ascending. The built-ins take 1000 and up, the same
   * reserved band the built-in nav entries use, so an application's cards
   * lead by default without having to pick a number at all.
   */
  order?: number;

  /**
   * Whether the card renders. Returning `false` removes it entirely.
   * Omitted means always.
   */
  can?: () => boolean;

  /**
   * The tile. Free to fetch its own data — it is mounted only after `can`
   * has already said its backend exists.
   */
  render: () => ReactNode;
}
