import { __bind, type Alepha, type Module } from "@alepha/core";
import { $realm, $role } from "@alepha/security";
import { $action, type ClientRequestOptions } from "./descriptors/$action.ts";
import { $route } from "./descriptors/$route.ts";
import type { HttpError } from "./errors/HttpError.ts";
import type {
	ServerRequest,
	ServerRequestConfigEntry,
	ServerResponse,
	ServerRoute,
} from "./interfaces/index.ts";
import { ServerBodyParserProvider } from "./providers/features/ServerBodyParserProvider.ts";
import { ServerLoggerProvider } from "./providers/features/ServerLoggerProvider.ts";
import { ServerMultipartProvider } from "./providers/features/ServerMultipartProvider.ts";
import { ServerNotReadyProvider } from "./providers/features/ServerNotReadyProvider.ts";
import { ServerSecurityProvider } from "./providers/features/ServerSecurityProvider.ts";
import { ServerTimingProvider } from "./providers/features/ServerTimingProvider.ts";
import { NodeHttpServerProvider } from "./providers/platforms/NodeHttpServerProvider.ts";
import { ServerProvider } from "./providers/platforms/ServerProvider.ts";
import { ServerActionDescriptorProvider } from "./providers/ServerActionDescriptorProvider.ts";
import { ServerRouteDescriptorProvider } from "./providers/ServerRouteDescriptorProvider.ts";
import type { FetchOptions, HttpAction } from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

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
		// last chance to modify the response -
		// TODO: probably not really needed, we can also update the response in the onResponse hook...
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
			route: HttpAction;
			config: ServerRequestConfigEntry;
			options: ClientRequestOptions;
			headers: Record<string, string>;
			request: RequestInit;
		};
		"client:beforeFetch": {
			url: string;
			options: FetchOptions;
			request: RequestInit;
		};
		"client:onError": {
			route?: HttpAction;
			error: HttpError;
		};
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export { KIND } from "@alepha/core";
export * from "./constants/routeMethods.ts";
export * from "./descriptors/$action.ts";
export * from "./descriptors/$route.ts";
export * from "./errors/BadRequestError.ts";
export * from "./errors/ConflictError.ts";
export * from "./errors/ForbiddenError.ts";
export * from "./errors/HttpError.ts";
export * from "./errors/NotFoundError.ts";
export * from "./errors/UnauthorizedError.ts";
export * from "./errors/ValidationError.ts";
export * from "./helpers/ActionDescriptorHelper.ts";
export * from "./helpers/ServerReply.ts";
export * from "./interfaces/index.ts";
export * from "./providers/features/ServerLoggerProvider.ts";
export * from "./providers/features/ServerMultipartProvider.ts";
export * from "./providers/features/ServerNotReadyProvider.ts";
export * from "./providers/features/ServerSecurityProvider.ts";
export * from "./providers/features/ServerTimingProvider.ts";
export * from "./providers/platforms/NodeHttpServerProvider.ts";
export * from "./providers/platforms/ServerProvider.ts";
export * from "./providers/ServerActionDescriptorProvider.ts";
export * from "./providers/ServerRouterProvider.ts";
export * from "./schemas/apiLinksResponseSchema.ts";
export * from "./schemas/errorSchema.ts";
export * from "./schemas/okSchema.ts";
export * from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServer implements Module {
	public readonly name = "alepha.server";
	public readonly $services = (alepha: Alepha) => {
		alepha.with({
			optional: true,
			provide: ServerProvider,
			use: NodeHttpServerProvider,
		});

		alepha.with(ServerActionDescriptorProvider);
		alepha.with(ServerRouteDescriptorProvider);
		alepha.with(ServerBodyParserProvider);
		alepha.with(ServerLoggerProvider);
		alepha.with(ServerMultipartProvider);
		alepha.with(ServerNotReadyProvider);

		if (!alepha.isProduction()) {
			alepha.with(ServerTimingProvider);
		}
	};
}

__bind($route, AlephaServer);
__bind($action, AlephaServer);
__bind($realm, ServerSecurityProvider);
__bind($role, ServerSecurityProvider);
