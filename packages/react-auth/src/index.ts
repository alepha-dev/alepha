import { $module } from "@alepha/core";
import { AlephaReact } from "@alepha/react";
import type { UserAccountInfo } from "@alepha/security";
import { AlephaServerCookies } from "@alepha/server-cookies";
import { AlephaServerSecurity } from "@alepha/server-security";
import { $auth } from "./descriptors/$auth.ts";
import { ReactAuthProvider } from "./providers/ReactAuthProvider.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$auth.ts";
export * from "./index.shared.ts";
export * from "./providers/ReactAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	export interface State {
		user?: UserAccountInfo;
	}
}
declare module "@alepha/react" {
	interface PageReactContext {
		user?: UserAccountInfo;
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
	services: [
		AlephaReact,
		AlephaServerSecurity,
		AlephaServerCookies,
		ReactAuthProvider,
		ReactAuth,
	],
});
