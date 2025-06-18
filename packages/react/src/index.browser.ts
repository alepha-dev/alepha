import { __bind, $inject, Alepha } from "@alepha/core";
import { $page } from "./descriptors/$page.ts";
import { BrowserRouterProvider } from "./providers/BrowserRouterProvider.ts";
import { PageDescriptorProvider } from "./providers/PageDescriptorProvider.ts";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider.ts";

export * from "./index.shared";
export * from "./providers/ReactBrowserProvider.ts";

export class ReactModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha //
			.with(PageDescriptorProvider)
			.with(ReactBrowserProvider)
			.with(BrowserRouterProvider);
	}
}

__bind($page, ReactModule);
