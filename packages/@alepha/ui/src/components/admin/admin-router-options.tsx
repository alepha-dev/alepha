import type { NavGroup } from "@alepha/ui/components/app-shell/app-shell";
import { $atom, z } from "alepha";
import type { ReactNode } from "react";
import type { AdminParametersProps } from "./admin-parameters.tsx";
import type { AdminUserDetailProps } from "./admin-user-detail.tsx";
import type { AdminUsersProps } from "./admin-users.tsx";

/**
 * Everything an application can change about `AdminRouter` without writing
 * its own.
 *
 * The seam is deliberately narrow: chrome slots plus the props of the three
 * pages that accept props. An application wanting different URLs, different
 * page composition or a different shell writes its own router — the same
 * trade `AuthRouter` documents.
 */
export interface AdminRouterOptions {
  /**
   * Sidebar header. Lore's back-arrow-plus-title and shop's Poinçon are both
   * just this.
   *
   * ⚠️ **It must handle the sidebar collapsing to an icon rail itself.**
   * `SidebarHeader` renders this node as given, at whatever width it asks for,
   * while the rail around it shrinks to about one icon — so a title with no
   * opinion about the collapsed state wraps, takes the header's height with
   * it, and overlaps the collapse toggle. Both apps have hit this.
   *
   * Tailwind exposes the state as a group data attribute, the same hook the
   * nav items use to drop their labels:
   *
   * ```tsx
   * brand: (
   *   <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
   *     <Mark className="shrink-0" />
   *     <span className="group-data-[collapsible=icon]:hidden">My App</span>
   *   </div>
   * )
   * ```
   *
   * Keep whatever reads as an icon, hide the words.
   */
  brand?: ReactNode;

  /**
   * Replaces the default language / dark-mode / account cluster entirely when
   * set. Supply the whole cluster, not an addition to it.
   *
   * The ⌘K search affordance is not part of the cluster and always renders:
   * the Spotlight state it opens lives inside the layout, where no
   * replacement cluster could reach it.
   */
  topbarActions?: ReactNode;

  /**
   * Extra class(es) merged onto the shell's root element.
   *
   * Exists for applications whose `/admin` lives inside a document they do
   * not fully own — a host page that paints fixed overlays over the viewport,
   * or hardcodes a theme class on `<html>` — and that need one stable hook to
   * fence the console off from that chrome. Styling inside the shell does not
   * go through this; components carry their own classes.
   */
  className?: string;

  /**
   * Set `false` to keep the shell from mounting `<ColorScheme />`.
   *
   * The shell mounts it because `/admin` is normally not a child of the
   * application's own layout, so nothing else would apply the dark-mode
   * atom's class to `<html>`. An application whose host document owns that
   * class itself — a hardcoded `<html class="dark">`, a theme manager of its
   * own — turns this off so entering `/admin` cannot rewrite the document's
   * theme underneath the rest of the app.
   *
   * @default true
   */
  colorScheme?: boolean;

  /**
   * Nav groups appended after the route-derived ones, for entries that map to
   * no route. Forwarded to `NavShell`'s own `extraNav`.
   */
  extraNav?: NavGroup[];

  /**
   * Route name the shell's "leave admin" affordance pushes.
   *
   * @default "home"
   */
  homeRouteName?: string;

  /**
   * Where a bare `/admin` redirects.
   *
   * Defaults to the users list, which is the first entry of the built-in
   * sidebar. An application whose back office is mostly its own pages will
   * want one of those instead.
   *
   * @default "/admin/users"
   */
  indexPath?: string;

  /**
   * Route name the shell's sign-in affordance pushes.
   *
   * `login` is the conventional name because `AuthRouter` mounts a page by
   * that name. This option exists for applications that mount their own auth
   * routes under a different name instead of `AuthRouter`.
   *
   * @default "login"
   */
  loginRouteName?: string;

  /**
   * Props forwarded to the three pages that accept them, keyed by page.
   *
   * Each entry reuses that component's own exported props interface rather
   * than restating its fields, so a prop added to `AdminUsers` is passable the
   * day it exists.
   */
  pages?: {
    users?: AdminUsersProps;
    userDetail?: AdminUserDetailProps;
    parameters?: AdminParametersProps;
  };
}

/**
 * Boot-time configuration for {@link AdminRouter}, following the
 * `linkOptionsAtom` / `oauthOptions` / `mcpStreamableHttpOptions` pattern:
 * the application calls `alepha.set(adminRouterOptionsAtom, { … })` once,
 * before start.
 *
 * The schema is a `z.custom` passthrough because the value carries React
 * nodes and component references, whose shape TypeScript already owns — the
 * exact case `z.custom`'s own documentation names. Nothing here crosses a
 * trust boundary: it is written by the application at boot and read only by
 * the admin shell.
 *
 * Being boot-configured also keeps it out of the SSR payload.
 * `StateManager.exportAtoms()` reads scope `"current"`, so it sees
 * request-scoped writes only and never an atom set on the app store — which
 * matters here, because a `ReactNode` would not survive JSON serialization.
 */
export const adminRouterOptionsAtom = $atom({
  name: "alepha.ui.admin.router.options",
  description: "Chrome slots and per-page props for the admin router.",
  schema: z.custom<AdminRouterOptions>(),
  default: {} satisfies AdminRouterOptions,
});
