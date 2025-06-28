import { __bind, $inject, Alepha } from "@alepha/core";
import {
	ServerLinksProvider,
	ServerModule,
	type ServerRequest,
} from "@alepha/server";
import { ServerCacheModule } from "@alepha/server-cache";
import { $page } from "./descriptors/$page.ts";
import {
	PageDescriptorProvider,
	type PageReactContext,
	type PageRequest,
	type RouterState,
} from "./providers/PageDescriptorProvider.ts";
import type { ReactHydrationState } from "./providers/ReactBrowserProvider.ts";
import { ReactServerProvider } from "./providers/ReactServerProvider.ts";

export { default as NestedView } from "./components/NestedView.tsx";
export * from "./errors/RedirectionError.ts";
export * from "./index.shared.ts";
export * from "./providers/PageDescriptorProvider.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactServerProvider.ts";

declare module "@alepha/core" {
	interface Hooks {
		"react:browser:render": {
			state: RouterState;
			context: PageReactContext;
			hydration?: ReactHydrationState;
		};
		"react:server:render": {
			request: ServerRequest;
			pageRequest: PageRequest;
		};
		"react:transition:begin": {
			state: RouterState;
			context: PageReactContext;
		};
		"react:transition:success": {
			state: RouterState;
		};
		"react:transition:error": {
			error: Error;
			state: RouterState;
			context: PageReactContext;
		};
		"react:transition:end": {
			state: RouterState;
			context: PageReactContext;
		};
	}
}

export class ReactModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha //
			.with(ServerModule)
			.with(ServerCacheModule)
			.with(ServerLinksProvider)
			.with(PageDescriptorProvider)
			.with(ReactServerProvider);
	}
}

__bind($page, ReactModule);
