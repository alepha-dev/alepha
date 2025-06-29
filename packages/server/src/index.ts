import {
	__bind,
	$inject,
	type Alepha,
	type Module,
	type Static,
	t,
} from "@alepha/core";
import { $realm, $role } from "@alepha/security";
import { $action, type ClientRequestOptions } from "./descriptors/$action.ts";
import { $proxy } from "./descriptors/$proxy.ts";
import { $remote } from "./descriptors/$remote.ts";
import { $route } from "./descriptors/$route.ts";
import type { HttpError } from "./errors/HttpError.ts";
import { ServerBodyParserProvider } from "./providers/features/ServerBodyParserProvider.ts";
import { ServerCompressProvider } from "./providers/features/ServerCompressProvider.ts";
import { ServerHealthProvider } from "./providers/features/ServerHealthProvider.ts";
import { ServerLinksProvider } from "./providers/features/ServerLinksProvider.ts";
import { ServerLoggerProvider } from "./providers/features/ServerLoggerProvider.ts";
import { ServerMultipartProvider } from "./providers/features/ServerMultipartProvider.ts";
import { ServerNotReadyProvider } from "./providers/features/ServerNotReadyProvider.ts";
import { ServerSecurityProvider } from "./providers/features/ServerSecurityProvider.ts";
import { ServerTimingProvider } from "./providers/features/ServerTimingProvider.ts";
import { ProxyDescriptorProvider } from "./providers/ProxyDescriptorProvider.ts";
import { NodeHttpServerProvider } from "./providers/platforms/NodeHttpServerProvider.ts";
import { ServerProvider } from "./providers/platforms/ServerProvider.ts";
import { RemoteDescriptorProvider } from "./providers/RemoteDescriptorProvider.ts";
import { ServerActionDescriptorProvider } from "./providers/ServerActionDescriptorProvider.ts";
import { ServerRouteDescriptorProvider } from "./providers/ServerRouteDescriptorProvider.ts";
import type {
	ServerRequest,
	ServerRequestConfigEntry,
	ServerResponse,
	ServerRoute,
} from "./providers/ServerRouterProvider.ts";
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
export * from "./descriptors/$action.ts";
export * from "./descriptors/$client.ts";
export * from "./descriptors/$proxy.ts";
export * from "./descriptors/$remote.ts";
export * from "./descriptors/$route.ts";
export * from "./errors/BadRequestError.ts";
export * from "./errors/ConflictError.ts";
export * from "./errors/ForbiddenError.ts";
export * from "./errors/HttpError.ts";
export * from "./errors/NotFoundError.ts";
export * from "./errors/UnauthorizedError.ts";
export * from "./errors/ValidationError.ts";
export * from "./providers/features/ServerHealthProvider.ts";
export * from "./providers/features/ServerLinksProvider.ts";
export * from "./providers/features/ServerLoggerProvider.ts";
export * from "./providers/features/ServerMultipartProvider.ts";
export * from "./providers/features/ServerNotReadyProvider.ts";
export * from "./providers/features/ServerSecurityProvider.ts";
export * from "./providers/features/ServerTimingProvider.ts";
export * from "./providers/ProxyDescriptorProvider.ts";
export * from "./providers/platforms/NodeHttpServerProvider.ts";
export * from "./providers/platforms/ServerProvider.ts";
export * from "./providers/RemoteDescriptorProvider.ts";
export * from "./providers/ServerActionDescriptorProvider.ts";
export * from "./providers/ServerRouterProvider.ts";
export * from "./schemas/apiLinksResponseSchema.ts";
export * from "./schemas/errorSchema.ts";
export * from "./schemas/okSchema.ts";
export * from "./services/HttpClient.ts";

const envSchema = t.object({
	SERVER_LINKS_ENABLED: t.boolean({
		default: true,
		description: "Enable links-provider, which expose APIs on /_links.",
	}),
	SERVER_HEALTH_ENABLED: t.boolean({
		default: true,
		description: "Enable health-provider, which expose APIs on /health.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class AlephaServer implements Module {
	protected readonly env = $inject(envSchema);

	public readonly name = "alepha.server";
	public readonly $services = (alepha: Alepha) => {
		alepha.with({
			optional: true,
			provide: ServerProvider,
			use: NodeHttpServerProvider,
		});

		alepha.with(ServerActionDescriptorProvider);
		alepha.with(ServerRouteDescriptorProvider);

		alepha.with(RemoteDescriptorProvider);
		alepha.with(ProxyDescriptorProvider);

		alepha.with(ServerBodyParserProvider);

		alepha.with(ServerLoggerProvider);
		alepha.with(ServerMultipartProvider);
		alepha.with(ServerCompressProvider);
		alepha.with(ServerNotReadyProvider);

		if (!alepha.isProduction()) {
			alepha.with(ServerTimingProvider);
		}

		if (this.env.SERVER_LINKS_ENABLED) {
			alepha.with(ServerLinksProvider);
		}

		if (this.env.SERVER_HEALTH_ENABLED) {
			alepha.with(ServerHealthProvider);
		}
	};
}

__bind($route, AlephaServer);
__bind($action, AlephaServer);
__bind($remote, AlephaServer);
__bind($proxy, AlephaServer);
__bind($realm, ServerSecurityProvider);
__bind($role, ServerSecurityProvider);
