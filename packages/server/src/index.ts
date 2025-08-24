import type {
	IncomingMessage,
	ServerResponse as NodeServerResponse,
} from "node:http";
import { $module, type Alepha, type DescriptorFactoryLike } from "@alepha/core";
import {
	$action,
	type ActionDescriptor,
	type ClientRequestOptions,
} from "./descriptors/$action.ts";
import { $route } from "./descriptors/$route.ts";
import type { HttpError } from "./errors/HttpError.ts";
import type {
	RequestConfigSchema,
	ServerRequest,
	ServerRequestConfigEntry,
	ServerResponse,
	ServerRoute,
} from "./interfaces/ServerRequest.ts";
import { NodeHttpServerProvider } from "./providers/NodeHttpServerProvider.ts";
import { ServerBodyParserProvider } from "./providers/ServerBodyParserProvider.ts";
import { ServerLoggerProvider } from "./providers/ServerLoggerProvider.ts";
import { ServerNotReadyProvider } from "./providers/ServerNotReadyProvider.ts";
import { ServerProvider } from "./providers/ServerProvider.ts";
import { ServerTimingProvider } from "./providers/ServerTimingProvider.ts";
import type { FetchOptions, HttpAction } from "./services/HttpClient.ts";
import { HttpClient } from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	interface Hooks {
		// -----------------------------------------------------------------------------------------------------------------
		// Local Actions hooks
		"action:onRequest": {
			action: ActionDescriptor<RequestConfigSchema>;
			request: ServerRequest;
			options: ClientRequestOptions;
		};
		"action:onResponse": {
			action: ActionDescriptor<RequestConfigSchema>;
			request: ServerRequest;
			options: ClientRequestOptions;
			response: any;
		};
		// -----------------------------------------------------------------------------------------------------------------
		// Server hooks
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
		// -----------------------------------------------------------------------------------------------------------------
		// Http client hooks
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
		// -----------------------------------------------------------------------------------------------------------------
		// Internal hooks
		"node:request": {
			req: IncomingMessage;
			res: NodeServerResponse;
		};
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$action.ts";
export * from "./descriptors/$route.ts";
export * from "./index.shared.ts";
export * from "./providers/NodeHttpServerProvider.ts";
export * from "./providers/ServerLoggerProvider.ts";
export * from "./providers/ServerNotReadyProvider.ts";
export * from "./providers/ServerProvider.ts";
export * from "./providers/ServerRouterProvider.ts";
export * from "./providers/ServerTimingProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides high-performance HTTP server capabilities with declarative routing and action descriptors.
 *
 * The server module enables building REST APIs and web applications using `$route` and `$action` descriptors
 * on class properties. It provides automatic request/response handling, schema validation, middleware support,
 * and seamless integration with other Alepha modules for a complete backend solution.
 *
 * @see {@link $route}
 * @see {@link $action}
 * @module alepha.server
 */
export const AlephaServer = $module({
	name: "alepha.server",
	descriptors: [$route, $action as DescriptorFactoryLike],
	services: [
		ServerProvider,
		NodeHttpServerProvider,
		ServerBodyParserProvider,
		ServerLoggerProvider,
		ServerNotReadyProvider,
		ServerTimingProvider,
		HttpClient,
	],
	register: (alepha: Alepha) => {
		alepha.with({
			optional: true,
			provide: ServerProvider,
			use: NodeHttpServerProvider,
		});

		alepha.with(ServerBodyParserProvider);
		alepha.with(ServerLoggerProvider);
		alepha.with(ServerNotReadyProvider);

		if (!alepha.isProduction()) {
			alepha.with(ServerTimingProvider);
		}
	},
});
