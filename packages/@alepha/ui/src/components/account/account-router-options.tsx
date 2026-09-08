import { $atom, z } from "alepha";
import type { ReactNode } from "react";

import type { AccountConnectionsProps } from "./account-connections.tsx";
import type { AccountKeysProps } from "./account-keys.tsx";
import type { AccountProfileProps } from "./account-profile.tsx";
import type { AccountSecurityProps } from "./account-security.tsx";
import type { AccountSessionsProps } from "./account-sessions.tsx";

/**
 * Everything an application can change about `AccountRouter` without writing
 * its own.
 *
 * The seam is narrower than the admin one, and deliberately so — an account
 * area is a handful of forms, not a console. An application wanting different
 * URLs or a different page set writes its own router; the same trade
 * `AuthRouter` documents.
 */
export interface AccountRouterOptions {
  /**
   * Replaces the default {@link AccountHeader} — the back link plus the
   * ambient controls — entirely. Supply the whole bar, not an addition to it.
   *
   * Set it to `null` for an account area nested inside an application's own
   * chrome, where a second header would just be a second row of the same
   * controls.
   */
  header?: ReactNode;

  /**
   * Route name the default header's back link points at. Ignored when
   * `header` is supplied, since that replaces the link too.
   *
   * @default "home"
   */
  homeRouteName?: string;

  /**
   * Extra class(es) merged onto the shell's root element, for an account area
   * living inside a document the application does not fully own.
   */
  className?: string;

  /**
   * Bound the account area to its parent's height and let its content column
   * scroll, rather than relying on the document to scroll.
   *
   * Set it whenever the application adopts `AccountRouter.layout` into a shell
   * that has taken the viewport height and hidden its overflow — the common
   * `h-svh … overflow-hidden` app frame. Without it those pages have no
   * scrollbar at all in such a shell, and everything past the fold is
   * unreachable rather than merely below.
   *
   * @default false — the account area scrolls with the document.
   */
  fill?: boolean;

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
  hide?: AccountPage[];
}

/**
 * The pages `AccountRouter` mounts, by the field that declares each one.
 *
 * Named rather than inlined so {@link AccountRouterOptions.hide} and the
 * router's own helper cannot drift apart on a rename.
 */
export type AccountPage =
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
  description: "Chrome slot and per-page props for the account router.",
  schema: z.custom<AccountRouterOptions>(),
  default: {} satisfies AccountRouterOptions,
});
