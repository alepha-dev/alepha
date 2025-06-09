import { $inject, Alepha, __bind } from "@alepha/core";
import { $action } from "./descriptors/$action.ts";
import { BrowserActionDescriptorProvider } from "./providers/BrowserActionDescriptorProvider.ts";

export * from "./constants/routeMethods.ts";
export * from "./descriptors/$action.ts";
export * from "./descriptors/$client.ts";
export * from "./providers/BrowserActionDescriptorProvider.ts";
export * from "./services/HttpClient.ts";
export * from "./schemas/errorSchema.ts";
export * from "./schemas/okSchema.ts";
export * from "./errors/HttpError.ts";

export class ServerModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(BrowserActionDescriptorProvider);
	}
}

__bind($action, ServerModule);
