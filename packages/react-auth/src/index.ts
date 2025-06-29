import { __bind, type Alepha, type Module } from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
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
 * Alepha React Authentication Module
 *
 * The ReactAuthModule provides authentication services for React applications.
 *
 * @see {@link ReactAuthProvider}
 * @module alepha.react.auth
 */
export class AlephaReactAuth implements Module {
	public readonly name = "alepha.react.auth";
	public readonly $services = (alepha: Alepha) => {
		alepha.with(ReactAuthProvider);
		alepha.with(ReactAuth);
	};
}

__bind($auth, AlephaReactAuth);
