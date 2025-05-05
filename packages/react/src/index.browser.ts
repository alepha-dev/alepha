import { $inject, Alepha, __bind } from "@alepha/core";
import { RouterProvider } from "@alepha/router";
import { $page } from "./descriptors/$page.ts";
import { BrowserRouterProvider } from "./providers/BrowserRouterProvider.ts";
import { PageDescriptorProvider } from "./providers/PageDescriptorProvider.ts";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider.ts";
import { ReactAuth } from "./services/ReactAuth.ts";

export * from "./index.shared";
export * from "./providers/ReactBrowserProvider.ts";

export class ReactModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha //
			.with(PageDescriptorProvider)
			.with(ReactBrowserProvider)
			.with(ReactAuth);

		this.alepha.with({
			provide: RouterProvider,
			use: BrowserRouterProvider,
		});
	}
}

__bind($page, ReactModule);
