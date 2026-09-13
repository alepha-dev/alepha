/**
 * The signed-in user's own account area.
 *
 * `AccountRouter` mounts profile, security, sessions, connections and API keys
 * under one layout, each page its own lazy chunk. The pages are exported by
 * name too, for an app that routes them itself.
 *
 * @module alepha.ui.account
 */

export { $pageAccount } from "./$pageAccount.tsx";
export {
  default as AccountConnections,
  type AccountConnectionsProps,
} from "./AccountConnections.tsx";
export {
  default as AccountKeys,
  type AccountKeysProps,
} from "./AccountKeys.tsx";
export { AccountLayout } from "./AccountLayout.tsx";
export {
  default as AccountProfile,
  type AccountProfileProps,
} from "./AccountProfile.tsx";
export { AccountRouter } from "./AccountRouter.tsx";
export {
  type AccountPage,
  type AccountRouterOptions,
  accountRouterOptionsAtom,
} from "./AccountRouterOptions.tsx";
export {
  default as AccountSecurity,
  type AccountSecurityProps,
} from "./AccountSecurity.tsx";
export {
  default as AccountSessions,
  type AccountSessionsProps,
} from "./AccountSessions.tsx";
