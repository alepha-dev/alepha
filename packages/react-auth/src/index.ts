import { $inject, Alepha, __bind } from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
import { $auth } from "./descriptors/$auth.ts";
import {
	ReactAuthProvider,
	type ReactUser,
} from "./providers/ReactAuthProvider.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

export * from "./index.shared.ts";
export * from "./providers/ReactAuthProvider.ts";

declare module "@alepha/react" {
	interface PageReactContext {
		user?: UserAccountToken;
	}
	export interface ReactHydrationState {
		user?: ReactUser;
	}
}

export class ReactAuthModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with(ReactAuthProvider);
		this.alepha.with(ReactAuth);
	}
}

__bind($auth, ReactAuthModule);
