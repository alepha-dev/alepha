import { $inject, Alepha, __bind } from "@alepha/core";
import { $page } from "./descriptors/$page.ts";
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
	}
}

__bind($page, ReactModule);
