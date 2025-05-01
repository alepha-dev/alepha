import { $inject, Alepha, autoInject } from "@alepha/core";
import { $page } from "./descriptors/$page";
import { PageDescriptorProvider } from "./providers/PageDescriptorProvider";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider";
import { Auth } from "./services/Auth";

export * from "./index.shared";
export * from "./providers/ReactBrowserProvider";

export class ReactModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha //
			.with(PageDescriptorProvider)
			.with(ReactBrowserProvider)
			.with(Auth);
	}
}

autoInject($page, ReactModule);
