/**
 * What a custom-scheme link resolved to.
 *
 * - `route`: `<scheme>://app/<path>`, a path of this app, with its query and
 *   hash.
 * - `auth`: `<scheme>://auth/callback`, reserved for a sign-in completed in
 *   the system browser.
 */
export type DeepLink =
  | { kind: "route"; path: string }
  | { kind: "auth"; url: URL };
