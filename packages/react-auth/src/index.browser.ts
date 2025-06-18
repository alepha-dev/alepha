import { __bind, $inject, Alepha } from "@alepha/core";
import { $auth } from "./descriptors/$auth.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

export * from "./index.shared";

export class ReactAuthModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with(ReactAuth);
	}
}

__bind($auth, ReactAuthModule);
