import type { Static } from "@alepha/core";
import { $inject, Alepha, autoInject, t } from "@alepha/core";
import { $permission, $realm, $role, SecurityModule } from "@alepha/security";
import { $proxy } from "./descriptors/$proxy";
import { $route } from "./descriptors/$route";
import type { RouteContext, RouteHandlerArgs } from "./descriptors/$route.ts";
import { $serve } from "./descriptors/$serve";
import { RouteServerDescriptorProvider } from "./providers/RouteServerDescriptorProvider";
import { ServerCookieProvider } from "./providers/ServerCookieProvider.ts";
import { ServerHealthProvider } from "./providers/ServerHealthProvider";
import { ServerLinksProvider } from "./providers/ServerLinksProvider";
import { ServerProvider } from "./providers/ServerProvider";
import type { RouteObject } from "./providers/ServerProvider.ts";
import { ServerSecurityProvider } from "./providers/ServerSecurityProvider.ts";
import { FastifyHelmetProvider } from "./providers/fastify/FastifyHelmetProvider";
import { FastifyMetricsProvider } from "./providers/fastify/FastifyMetricsProvider";
import { FastifyOpenApiProvider } from "./providers/fastify/FastifyOpenApiProvider";
import { FastifyServerProvider } from "./providers/fastify/FastifyServerProvider";
import { MockServerProvider } from "./providers/mock/MockServerProvider";

declare module "@alepha/core" {
	interface Hooks {
		"server:onRequest": {
			request: RouteHandlerArgs;
			context: RouteContext;
			route: RouteObject;
		};
		"server:onRoute": {
			route: RouteObject;
		};
		"server:onSend": {
			request: RouteHandlerArgs;
			context: RouteContext;
			route: RouteObject;
			status: number;
			ms: number;
		};
	}
}

export { KIND } from "@alepha/core";
export * from "./descriptors/$proxy";
export * from "./descriptors/$remote";
export * from "./descriptors/$route";
export * from "./descriptors/$serve";
export * from "./descriptors/$cookie";
export * from "./helpers/createMultipartFile";
export * from "./helpers/createResponseFile";
export * from "./helpers/CookieManager";
export * from "./helpers/streamToBuffer";
export * from "./providers/ServerCookieProvider.ts";
export * from "./providers/fastify/FastifyHelmetProvider";
export * from "./providers/fastify/FastifyMultipartProvider";
export * from "./providers/fastify/FastifyOpenApiProvider";
export * from "./providers/ServerSecurityProvider.ts";
export * from "./providers/fastify/FastifyServerProvider";
export * from "./providers/MultipartTypeProvider";
export * from "./providers/RouteBrowserDescriptorProvider";
export * from "./providers/ServerLinksProvider";
export * from "./providers/ServerProvider";
export * from "./schemas/errorSchema";
export * from "./schemas/okSchema";
export * from "./services/HttpClient";

export * from "./errors/BadRequestError";
export * from "./errors/ConflictError";
export * from "./errors/ForbiddenError";
export * from "./errors/HttpError";
export * from "./errors/NotFoundError";
export * from "./errors/UnauthorizedError";
export * from "./errors/ValidationError";

const envSchema = t.object({
	SERVER_PROVIDER: t.enum(["fastify", "mock"], { default: "fastify" }),
	SERVER_OPENAPI_ENABLED: t.boolean({
		default: false,
		description: "Enable the OpenAPI endpoint.",
	}),
	SERVER_METRICS_ENABLED: t.boolean({
		default: false,
		description: "Enable the metrics endpoint.",
	}),
	SERVER_HEALTH_ENABLED: t.boolean({
		default: false,
		description: "Enable the health check endpoint.",
	}),
	SERVER_SECURITY_ENABLED: t.optional(
		t.boolean({
			description: "Enable security for all endpoints by default.",
		}),
	),
	SERVER_LINKS_ENABLED: t.boolean({
		default: false,
		description: "Enable links provider which expose APIs on an URL.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ServerModule {
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);

	constructor() {
		const provider = this.env.SERVER_PROVIDER;

		if (provider === "fastify") {
			this.registerFastify();
		} else {
			this.alepha.register({
				provide: ServerProvider,
				use: MockServerProvider,
			});
		}

		if (this.env.SERVER_HEALTH_ENABLED) {
			this.alepha.register(ServerHealthProvider);
		}

		if (this.env.SERVER_SECURITY_ENABLED) {
			this.alepha.register(SecurityModule);
		}

		if (this.env.SERVER_LINKS_ENABLED) {
			this.alepha.register(ServerLinksProvider);
		}

		if (this.env.SERVER_SECURITY_ENABLED) {
			this.alepha.register(ServerSecurityModule);
		}

		this.alepha.register(RouteServerDescriptorProvider);
	}

	protected registerFastify() {
		// Fastify
		this.alepha
			.register({
				provide: ServerProvider,
				use: FastifyServerProvider,
			})
			.register(ServerCookieProvider)
			.register(FastifyHelmetProvider);

		if (this.env.SERVER_OPENAPI_ENABLED) {
			this.alepha.register(FastifyOpenApiProvider);
		}

		if (this.env.SERVER_METRICS_ENABLED) {
			this.alepha.register(FastifyMetricsProvider);
		}

		if (this.env.SERVER_SECURITY_ENABLED || this.alepha.has(SecurityModule)) {
			this.alepha.register(ServerSecurityProvider);
		}
	}
}

export class ServerSecurityModule {
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);

	constructor() {
		if (this.env.SERVER_PROVIDER === "fastify") {
			this.alepha.register(ServerSecurityProvider);
		}
	}
}

autoInject($route, ServerModule);
autoInject($proxy, ServerModule);
autoInject($serve, ServerModule);

autoInject($realm, ServerSecurityModule);
autoInject($role, ServerSecurityModule);
autoInject($permission, ServerSecurityModule);
