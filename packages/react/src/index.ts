import { $inject, Alepha, type Static, __bind, t } from "@alepha/core";
import { ServerLinksProvider, ServerModule } from "@alepha/server";
import { $auth } from "./descriptors/$auth.ts";
import { $page } from "./descriptors/$page.ts";
import { PageDescriptorProvider } from "./providers/PageDescriptorProvider.ts";
import { ReactAuthProvider } from "./providers/ReactAuthProvider.ts";
import { ReactServerProvider } from "./providers/ReactServerProvider.ts";
import { ReactAuth } from "./services/ReactAuth.ts";
export { default as NestedView } from "./components/NestedView.tsx";

export * from "./index.shared";
export * from "./providers/PageDescriptorProvider.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactServerProvider.ts";
export * from "./providers/ReactAuthProvider.ts";
export * from "./errors/RedirectionError.ts";

const envSchema = t.object({
	REACT_AUTH_ENABLED: t.boolean({ default: false }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ReactModule {
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha //
			.with(ServerModule)
			.with(ServerLinksProvider)
			.with(PageDescriptorProvider)
			.with(ReactServerProvider);

		if (this.env.REACT_AUTH_ENABLED) {
			this.alepha.with(ReactAuthProvider);
			this.alepha.with(ReactAuth);
		}
	}
}

__bind($page, ReactModule);
__bind($auth, ReactAuthProvider, ReactAuth);
