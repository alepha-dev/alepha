import { $module } from "alepha";
import { AlephaReact } from "alepha/react";
import type { UserAccount } from "alepha/security";
import { $auth, AlephaServerAuth } from "alepha/server/auth";
import { AlephaServerLinks } from "alepha/server/links";
import { ReactAuthProvider } from "./providers/ReactAuthProvider.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/ReactAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/react/router" {
  interface ReactRouterState {
    user?: UserAccount;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.8.0 | node, bun, browser|
 *
 * Auth-related React components and hooks.
 *
 * **Features:**
 * - Login/logout components
 * - Protected route wrappers
 * - Auth state hooks
 *
 * @module alepha.react.auth
 */
export const AlephaReactAuth = $module({
  name: "alepha.react.auth",
  primitives: [$auth],
  services: [
    AlephaReact,
    AlephaServerLinks,
    AlephaServerAuth,
    ReactAuthProvider,
    ReactAuth,
  ],
});
