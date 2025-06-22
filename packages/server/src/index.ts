import {
	__bind,
	$inject,
	Alepha,
	type Service,
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
import { ServerCacheProvider } from "./providers/features/ServerCacheProvider.ts";
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
	SERVER_NOT_READY_ENABLED: t.boolean({
		default: true,
		description:
			"Enable not-ready-provider, which return 503 if alepha is not ready.",
	}),
	SERVER_TIMING_ENABLED: t.optional(
		t.boolean({
			description:
				"Enable server timing provider. True by default in development, false in production.",
		}),
	),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ServerModule {
	static plugins: Array<Service> = [];

	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with({
			default: true,
			provide: ServerProvider,
			use: NodeHttpServerProvider,
		});

		this.alepha.with(ServerActionDescriptorProvider);
		this.alepha.with(ServerRouteDescriptorProvider);
		this.alepha.with(RemoteDescriptorProvider);
		this.alepha.with(ProxyDescriptorProvider);

		this.alepha.with(ServerLoggerProvider);
		this.alepha.with(ServerBodyParserProvider);
		this.alepha.with(ServerMultipartProvider);
		this.alepha.with(ServerCompressProvider);
		this.alepha.with(ServerCacheProvider);

		if (this.env.SERVER_TIMING_ENABLED ?? !this.alepha.isProduction()) {
			this.alepha.with(ServerTimingProvider);
		}

		if (this.env.SERVER_LINKS_ENABLED) {
			this.alepha.with(ServerLinksProvider);
		}

		if (this.env.SERVER_HEALTH_ENABLED) {
			this.alepha.with(ServerHealthProvider);
		}

		if (this.env.SERVER_NOT_READY_ENABLED) {
			this.alepha.with(ServerNotReadyProvider);
		}
	}
}

__bind($route, ServerModule);
__bind($action, ServerModule);
__bind($remote, ServerModule);
__bind($proxy, ServerModule);
__bind($realm, ServerSecurityProvider);
__bind($role, ServerSecurityProvider);
