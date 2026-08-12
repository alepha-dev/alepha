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
   */
  brand?: ReactNode;

  /**
   * Replaces the default language / dark-mode / account cluster entirely when
   * set. Supply the whole cluster, not an addition to it.
   */
  topbarActions?: ReactNode;

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
