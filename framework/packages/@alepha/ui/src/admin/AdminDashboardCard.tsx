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
 * `render` owns the tile's whole surface, because a stat tile, a chart and a
 * table of recent rows have nothing useful in common above the card boundary.
 * `title` and `description` are not drawn on the tile: they name it in the
 * Customize picker, where an admin chooses which tiles show.
 *
 * ### Catalog and layout
 *
 * The built-in cards and `AdminRouterOptions.dashboardCards` together are the
 * catalog; ids are unique across it (a duplicate throws at startup). The
 * deployment's stored layout says which show and in what order; a card it
 * does not name yet shows when `defaultEnabled`, so a new release's tile
 * appears without anyone editing the layout.
 */
export interface AdminDashboardCard {
  /**
   * Stable identity, also the React key. Must be unique across the built-in
   * cards and the application's own.
   */
  id: string;

  /**
   * The tile's name in the Customize picker, in English: the fallback when
   * `titleKey` is absent or has no translation. Required, so a tile is never
   * a nameless row in the picker.
   */
  title: string;

  /**
   * Catalogue key for {@link title}, resolved when the picker renders and
   * never stored in the layout.
   */
  titleKey?: string;

  /**
   * One line under the title in the picker: what the tile shows.
   */
  description?: string;

  /**
   * Catalogue key for {@link description}, resolved like `titleKey`.
   */
  descriptionKey?: string;

  /**
   * Whether the tile shows while the stored layout does not name it: with no
   * layout saved, and when a release adds it to a deployment that has one.
   *
   * @default true
   */
  defaultEnabled?: boolean;

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
