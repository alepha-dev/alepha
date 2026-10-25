import { $atom, z } from "alepha";
import type { ReactNode } from "react";

import type { NavGroup } from "../shell/appShellNav.tsx";
import type { AccountConnectionsProps } from "./AccountConnections.tsx";
import type { AccountKeysProps } from "./AccountKeys.tsx";
import type { AccountProfileProps } from "./AccountProfile.tsx";
import type { AccountSecurityProps } from "./AccountSecurity.tsx";
import type { AccountSessionsProps } from "./AccountSessions.tsx";

/**
 * Everything an application can change about `AccountRouter` without writing
 * its own.
 *
 * The chrome slots mirror `AdminRouterOptions`, because the account area is
 * the same kind of shell: a root `NavShell` with its own sidebar and topbar,
 * never adopted into the application's layout. The page seam is narrower: an
 * application wanting different URLs or a different page set writes its own
 * router, the same trade `AuthRouter` documents.
 *
 * There is no `header` and no `fill` any more. Both existed for an account
 * area nested inside the application's chrome (#F111), which is no longer a
 * way to mount it: the shell owns the viewport, so it has nothing to bound
 * and no second header to suppress.
 */
export interface AccountRouterOptions {
  /**
   * Sidebar header. Defaults to `AccountBrand`: the signed-in user's avatar
   * and name, the account area being theirs.
   *
   * ⚠️ **It must handle the sidebar collapsing to an icon rail itself**, the
   * same contract as `AdminRouterOptions.brand`: keep whatever reads as an
   * icon, hide the words with `group-data-[collapsible=icon]:hidden`.
   */
  brand?: ReactNode;

  /**
   * Replaces the default account cluster (`ButtonSettings`: language, theme,
   * display mode and the way back to the site) entirely when set. Supply the
   * whole cluster, not an addition to it.
   *
   * The ⌘K search affordance is not part of the cluster and always renders:
   * the Spotlight state it opens lives inside the layout.
   */
  topbarActions?: ReactNode;

  /**
   * Route name the account menu's "Back to site" item pushes: the way out of
   * a shell that, like `/admin`, is not drawn inside the application's own
   * chrome.
   *
   * @default "home"
   */
  homeRouteName?: string;

  /**
   * Route name the account menu's sign-in affordance pushes, for an
   * application mounting its auth pages under another name than
   * `AuthRouter`'s `login`. See `AdminRouterOptions.loginRouteName` for why
   * it answers this one button and not the router.
   *
   * @default "login"
   */
  loginRouteName?: string;

  /**
   * Set `false` to keep the shell from mounting `<ColorScheme />`.
   *
   * The shell mounts it because `/account` is a root shell, not a child of
   * the application's layout, so nothing else would apply the dark-mode
   * class to `<html>`. An application whose host document owns that class
   * itself turns this off.
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
   * Extra class(es) merged onto the shell's root element, for an account area
   * living inside a document the application does not fully own.
   */
  className?: string;

  /**
   * Props forwarded to the pages, keyed by page.
   *
   * Each entry reuses that component's own exported props interface rather
   * than restating its fields, so a prop added to a page is passable the day
   * it exists.
   */
  pages?: {
    profile?: AccountProfileProps;
    security?: AccountSecurityProps;
    sessions?: AccountSessionsProps;
    keys?: AccountKeysProps;
    connections?: AccountConnectionsProps;
  };

  /**
   * Pages this application does not offer at all.
   *
   * Each page is already gated on whether the action behind it is mounted,
   * and that answers most of the question: the API-keys page really does
   * disappear for an application that never mounts `AlephaApiKeys`.
   *
   * ⚠️ **It cannot answer a page whose action is always mounted.**
   * `MyConnectionController` ships with `$realm` and is `$secure()` with no
   * permission, so `listMyConnections` exists in every application ever
   * built on this router - and "Connected apps" was therefore offered to
   * citizens of a public service that has no OAuth client in the world, over
   * a list that is empty by construction. Whether the API exists is the
   * registry's question; whether the application offers it is the
   * application's, and only the application can answer the second.
   *
   * ANDed with the existing gate, never instead of it. A hidden page is
   * absent from the rail and refused on direct entry, exactly as one whose
   * action is missing already is.
   *
   * ⚠️ A list of exceptions rather than an allowlist, and that is the
   * difference from the `pages: [...]` this router's own doc block rules
   * out: an allowlist has to be kept complete, so a page added here would
   * vanish from every application that had already written one down. Unset
   * changes nothing, and a new page is offered by default.
   *
   * ```ts
   * alepha.set(accountRouterOptionsAtom, { hide: ["connections"] });
   * ```
   */
  hide?: AccountPageName[];
}

/**
 * The pages `AccountRouter` mounts, by the field that declares each one.
 *
 * Named rather than inlined so {@link AccountRouterOptions.hide} and the
 * router's own helper cannot drift apart on a rename.
 */
export type AccountPageName =
  | "profile"
  | "security"
  | "sessions"
  | "keys"
  | "connections";

/**
 * Boot-time configuration for `AccountRouter`, following the
 * `adminRouterOptionsAtom` pattern: the application calls
 * `alepha.set(accountRouterOptionsAtom, { … })` once, before start.
 *
 * `z.custom` passthrough because the value carries React nodes, whose shape
 * TypeScript already owns. Being boot-configured also keeps it out of the SSR
 * payload — `StateManager.exportAtoms()` reads request scope only, and a
 * `ReactNode` would not survive JSON serialization.
 */
export const accountRouterOptionsAtom = $atom({
  name: "alepha.ui.account.router.options",
  description: "Chrome slots and per-page props for the account router.",
  schema: z.custom<AccountRouterOptions>(),
  default: {} satisfies AccountRouterOptions,
});
