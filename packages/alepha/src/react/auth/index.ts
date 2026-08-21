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
 * Auth-related React components and hooks.
 *
 * **Features:**
 * - Auth state hooks (`useAuth`)
 *
 * Route protection is done with `use: [$secure(...)]` on the page or action,
 * not with wrapper components.
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
