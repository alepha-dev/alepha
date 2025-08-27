import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { AlephaServerLinks } from "@alepha/server-links";
import { $page } from "./descriptors/$page.ts";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider.ts";
import { ReactBrowserRendererProvider } from "./providers/ReactBrowserRendererProvider.ts";
import { ReactBrowserRouterProvider } from "./providers/ReactBrowserRouterProvider.ts";
import { ReactPageProvider } from "./providers/ReactPageProvider.ts";
import { ReactRouter } from "./services/ReactRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactBrowserRouterProvider.ts";
export * from "./providers/ReactPageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReact = $module({
	name: "alepha.react",
	descriptors: [$page],
	services: [
		ReactPageProvider,
		ReactBrowserRouterProvider,
		ReactBrowserProvider,
		ReactRouter,
		ReactBrowserRendererProvider,
	],
	register: (alepha) =>
		alepha
			.with(AlephaServer)
			.with(AlephaServerLinks)
			.with(ReactPageProvider)
			.with(ReactBrowserProvider)
			.with(ReactBrowserRouterProvider)
			.with(ReactBrowserRendererProvider)
			.with(ReactRouter),
});
