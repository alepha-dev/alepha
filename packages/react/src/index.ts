import { $module } from "@alepha/core";
import { AlephaServer, type ServerRequest } from "@alepha/server";
import { AlephaServerCache } from "@alepha/server-cache";
import { AlephaServerLinks } from "@alepha/server-links";
import { $page } from "./descriptors/$page.ts";
import {
	PageDescriptorProvider,
	type PageReactContext,
	type PageRequest,
	type RouterState,
} from "./providers/PageDescriptorProvider.ts";
import {
	ReactBrowserProvider,
	type ReactHydrationState,
} from "./providers/ReactBrowserProvider.ts";
import { ReactServerProvider } from "./providers/ReactServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/PageDescriptorProvider.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	interface Hooks {
		"react:router:createLayers": {
			request: ServerRequest;
			context: PageRequest;
			layers: PageRequest[];
		};
		"react:server:render:begin": {
			request?: ServerRequest;
			context: PageRequest;
		};
		"react:server:render:end": {
			request?: ServerRequest;
			context: PageRequest;
			state: RouterState;
			html: string;
		};
		"react:browser:render": {
			state: RouterState;
			context: PageReactContext;
			hydration?: ReactHydrationState;
		};
		"react:transition:begin": {
			state: RouterState;
			context: PageReactContext;
		};
		"react:transition:success": {
			state: RouterState;
			context: PageReactContext;
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

/**
 * Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.
 *
 * The React module enables building modern React applications using the `$page` descriptor on class properties.
 * It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
 * type safety and schema validation for route parameters and data.
 *
 * @see {@link $page}
 * @module alepha.react
 */
export const AlephaReact = $module({
	name: "alepha.react",
	descriptors: [$page],
	services: [ReactServerProvider, PageDescriptorProvider, ReactBrowserProvider],
	register: (alepha) =>
		alepha
			.with(AlephaServer)
			.with(AlephaServerCache)
			.with(AlephaServerLinks)
			.with(ReactServerProvider)
			.with(PageDescriptorProvider),
});
