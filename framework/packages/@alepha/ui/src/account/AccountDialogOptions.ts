import { $atom, z } from "alepha";

import type { AccountConnectionsProps } from "./AccountConnections.tsx";
import type { AccountKeysProps } from "./AccountKeys.tsx";
import type { AccountProfileProps } from "./AccountProfile.tsx";
import type { AccountSecurityProps } from "./AccountSecurity.tsx";
import type { AccountSessionsProps } from "./AccountSessions.tsx";

/**
 * Everything an application can change about `AccountDialog` without
 * declaring its own sections: which built-in sections it offers, and the
 * props each one gets.
 *
 * There is no chrome here. The dialog draws over the application's own page,
 * inside its own `DialogProvider`, so it has no brand, topbar, way home or
 * colour scheme of its own to configure.
 */
export interface AccountDialogOptions {
  /**
   * Props forwarded to the sections, keyed by section.
   *
   * Each entry reuses that component's own exported props interface rather
   * than restating its fields, so a prop added to a section is passable the
   * day it exists.
   */
  pages?: {
    profile?: AccountProfileProps;
    security?: AccountSecurityProps;
    sessions?: AccountSessionsProps;
    keys?: AccountKeysProps;
    connections?: AccountConnectionsProps;
  };

  /**
   * Sections this application does not offer at all.
   *
   * Each section is already gated on whether the action behind it is
   * mounted, and that answers most of the question: the API-keys section
   * really does disappear for an application that never mounts
   * `AlephaApiKeys`.
   *
   * ⚠️ **It cannot answer a section whose action is always mounted.**
   * `MyConnectionController` ships with `$realm` and is `$secure()` with no
   * permission, so `listMyConnections` exists in every application, and
   * "Connected apps" would be offered to the users of a service that has no
   * OAuth client in the world, over a list that is empty by construction.
   * Whether the API exists is the registry's question; whether the
   * application offers it is the application's.
   *
   * ANDed with the existing gate, never instead of it. A list of exceptions
   * rather than an allowlist: unset changes nothing, and a new section is
   * offered by default.
   *
   * ```ts
   * alepha.set(accountDialogOptionsAtom, { hide: ["connections"] });
   * ```
   */
  hide?: AccountSectionName[];
}

/**
 * The sections `AccountDialog` declares, by the field that declares each one
 * (and the value `?account=` takes to open it).
 */
export type AccountSectionName =
  | "profile"
  | "security"
  | "sessions"
  | "keys"
  | "connections";

/**
 * Boot-time configuration for `AccountDialog`: the application calls
 * `alepha.set(accountDialogOptionsAtom, { … })` once, before start.
 *
 * `z.custom` passthrough because the value may carry React nodes (a
 * `deleteWarning`), whose shape TypeScript already owns. Being
 * boot-configured also keeps it out of the SSR payload.
 */
export const accountDialogOptionsAtom = $atom({
  name: "alepha.ui.account.dialog.options",
  description: "Hidden sections and per-section props for the account dialog.",
  schema: z.custom<AccountDialogOptions>(),
  default: {} satisfies AccountDialogOptions,
});
