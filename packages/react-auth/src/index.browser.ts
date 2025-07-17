import { $module, type Alepha } from "@alepha/core";
import { $auth } from "./descriptors/$auth.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReactAuth = $module({
	name: "alepha.react.auth",
	descriptors: [$auth],
	register: (alepha: Alepha) => {
		alepha.with(ReactAuth);
	},
});
