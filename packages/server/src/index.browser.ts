import { $inject, Alepha, autoInject } from "@alepha/core";
import { $route } from "./descriptors/$route";
import { RouteBrowserDescriptorProvider } from "./providers/RouteBrowserDescriptorProvider";

export * from "./descriptors/$route";
export * from "./helpers/createMultipartFile";
export * from "./helpers/streamToBuffer";
export * from "./providers/MultipartTypeProvider";
export * from "./providers/RouteBrowserDescriptorProvider";
export * from "./schemas/errorSchema";
export * from "./schemas/okSchema";
export * from "./services/HttpClient";
export * from "./errors/HttpError";

export class ServerModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(RouteBrowserDescriptorProvider);
	}
}

autoInject($route, ServerModule);
