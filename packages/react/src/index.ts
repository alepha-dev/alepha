import { $inject, Alepha, type Static, autoInject, t } from "@alepha/core";
import { ServerLinksProvider, ServerModule } from "@alepha/server";
import { $auth } from "./descriptors/$auth";
import { $page } from "./descriptors/$page";
import { PageDescriptorProvider } from "./providers/PageDescriptorProvider";
import { ReactAuthProvider } from "./providers/ReactAuthProvider";
import { ReactServerProvider } from "./providers/ReactServerProvider";
import { Auth } from "./services/Auth";
export { default as NestedView } from "./components/NestedView";

export * from "./index.shared";
export * from "./providers/PageDescriptorProvider";
export * from "./providers/ReactBrowserProvider";
export * from "./providers/ReactServerProvider";
export * from "./providers/ReactAuthProvider";
export * from "./services/Router";
export * from "./errors/RedirectionError";

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
			this.alepha.with(Auth);
		}
	}
}

autoInject($page, ReactModule);
autoInject($auth, ReactAuthProvider, Auth);
