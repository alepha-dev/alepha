import { __bind, type Alepha, type Module } from "@alepha/core";
import { AlephaServer, type ServerRequest } from "@alepha/server";
import { AlephaServerCache } from "@alepha/server-cache";
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

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaReact implements Module {
	public readonly name = "alepha.react";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with(AlephaServer)
			.with(AlephaServerCache)
			.with(ReactServerProvider)
			.with(PageDescriptorProvider);
}

__bind($page, AlephaReact);
