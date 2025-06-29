import { __bind, type Alepha, type Module } from "@alepha/core";
import { $auth } from "./descriptors/$auth.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaReactAuth implements Module {
	public readonly name = "alepha.react.auth";
	public readonly $services = (alepha: Alepha) => {
		alepha.with(ReactAuth);
	};
}

__bind($auth, AlephaReactAuth);
