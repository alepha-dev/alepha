import { __bind, type Alepha, type Module } from "@alepha/core";
import { $page } from "./descriptors/$page.ts";
import { BrowserRouterProvider } from "./providers/BrowserRouterProvider.ts";
import { PageDescriptorProvider } from "./providers/PageDescriptorProvider.ts";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider.ts";
import { ReactBrowserRenderer } from "./providers/ReactBrowserRenderer.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/BrowserRouterProvider.ts";
export * from "./providers/PageDescriptorProvider.ts";
export * from "./providers/ReactBrowserProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaReact implements Module {
	public readonly name = "alepha.react";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with(PageDescriptorProvider)
			.with(ReactBrowserProvider)
			.with(BrowserRouterProvider)
			.with(ReactBrowserRenderer);
}

__bind($page, AlephaReact);
