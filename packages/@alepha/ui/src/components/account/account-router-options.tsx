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
   * Full-width block above the rail and the content — the identity card, a
   * back link, a page title.
   *
   * This is the *whole* top of the shell rather than a slot inside a chrome
   * the shell also draws. That is why there is no `homeRouteName` option to
   * go with it, unlike admin: admin renders its own "leave admin" affordance
   * separately from `brand` and needs to know where it goes, whereas here an
   * application that wants a Home button simply puts one in the header it is
   * already supplying.
   */
  header?: ReactNode;

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
}

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
