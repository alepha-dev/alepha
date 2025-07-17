import { $module } from "@alepha/core";
import { AlephaReact } from "@alepha/react";
import type { UserAccountToken } from "@alepha/security";
import { AlephaServerCookies } from "@alepha/server-cookies";
import { $auth } from "./descriptors/$auth.ts";
import {
	ReactAuthProvider,
	type ReactUser,
} from "./providers/ReactAuthProvider.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/ReactAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/react" {
	interface PageReactContext {
		user?: UserAccountToken;
	}
	export interface ReactHydrationState {
		user?: ReactUser;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The ReactAuthModule provides authentication services for React applications.
 *
 * @see {@link ReactAuthProvider}
 * @module alepha.react.auth
 */
export const AlephaReactAuth = $module({
	name: "alepha.react.auth",
	descriptors: [$auth],
	services: [AlephaReact, AlephaServerCookies, ReactAuthProvider, ReactAuth],
});
