import { $inject, Alepha, type Static, __bind, t } from "@alepha/core";
import { $realm, $role } from "@alepha/security";
import {
	$action,
	$route,
	type ClientRequestOptions,
} from "./descriptors/$action.ts";
import { $remote } from "./descriptors/$remote.ts";
import type { HttpError } from "./errors/HttpError.ts";
import { ServerActionDescriptorProvider } from "./providers/ServerActionDescriptorProvider.ts";
import type {
	ServerRequest,
	ServerRequestConfigEntry,
	ServerResponse,
	ServerRoute,
} from "./providers/ServerRouterProvider.ts";
import { ServerBodyParserProvider } from "./providers/features/ServerBodyParserProvider.ts";
import { ServerLinksProvider } from "./providers/features/ServerLinksProvider.ts";
import { ServerLoggerProvider } from "./providers/features/ServerLoggerProvider.ts";
import { ServerMultipartProvider } from "./providers/features/ServerMultipartProvider.ts";
import { ServerSecurityProvider } from "./providers/features/ServerSecurityProvider.ts";
import { NodeHttpServerProvider } from "./providers/platforms/NodeHttpServerProvider.ts";
import { ServerProvider } from "./providers/platforms/ServerProvider.ts";
import type { FetchRunOptions, HttpClientLink } from "./services/HttpClient.ts";

declare module "@alepha/core" {
	interface Hooks {
		"server:onRoute": {
			route: ServerRoute;
		};
		"server:onRequest": {
			route: ServerRoute;
			request: ServerRequest;
		};
		"server:onError": {
			route: ServerRoute;
			request: ServerRequest;
			error: Error;
		};
		// last chance to modify the response
		"server:onSend": {
			route: ServerRoute;
			request: ServerRequest;
		};
		// response is ready
		"server:onResponse": {
			route: ServerRoute;
			request: ServerRequest;
			response: ServerResponse;
		};
		"client:onRequest": {
			route: HttpClientLink;
			config: ServerRequestConfigEntry;
			options: ClientRequestOptions;
			headers: Record<string, string>;
			request: RequestInit;
		};
		"client:beforeFetch": {
			url: string;
			options: FetchRunOptions;
			request: RequestInit;
		};
		"client:onError": {
			route?: HttpClientLink;
			error: HttpError;
		};
	}
}

export { KIND } from "@alepha/core";
export * from "./constants/routeMethods.ts";
export * from "./descriptors/$remote.ts";
export * from "./descriptors/$action.ts";
export * from "./providers/ServerRouterProvider.ts";
export * from "./providers/ServerActionDescriptorProvider.ts";
export * from "./providers/BrowserActionDescriptorProvider.ts";
export * from "./providers/features/ServerSecurityProvider.ts";
export * from "./providers/features/ServerLinksProvider.ts";
export * from "./providers/features/ServerLoggerProvider.ts";
export * from "./providers/features/ServerMultipartProvider.ts";
export * from "./providers/platforms/ServerProvider.ts";
export * from "./providers/platforms/NodeHttpServerProvider.ts";
export * from "./schemas/errorSchema.ts";
export * from "./schemas/okSchema.ts";
export * from "./services/HttpClient.ts";

export * from "./errors/BadRequestError.ts";
export * from "./errors/ConflictError.ts";
export * from "./errors/ForbiddenError.ts";
export * from "./errors/HttpError.ts";
export * from "./errors/NotFoundError.ts";
export * from "./errors/UnauthorizedError.ts";
export * from "./errors/ValidationError.ts";

const envSchema = t.object({
	SERVER_LINKS_ENABLED: t.boolean({
		default: true,
		description: "Enable links-provider, which expose APIs on /api/_links.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ServerModule {
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with({
			default: true,
			provide: ServerProvider,
			use: NodeHttpServerProvider,
		});

		this.alepha.with(ServerActionDescriptorProvider);

		this.alepha.with(ServerLoggerProvider);
		this.alepha.with(ServerBodyParserProvider);
		this.alepha.with(ServerMultipartProvider);

		if (this.env.SERVER_LINKS_ENABLED) {
			this.alepha.with(ServerLinksProvider);
		}
	}
}

__bind($route, ServerModule);
__bind($action, ServerModule);
__bind($remote, ServerModule);
__bind($realm, ServerSecurityProvider);
__bind($role, ServerSecurityProvider);
