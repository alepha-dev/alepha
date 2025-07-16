import type {
	IncomingMessage,
	ServerResponse as NodeServerResponse,
} from "node:http";
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
		"node:request": {
			req: IncomingMessage;
			res: NodeServerResponse;
		};
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
		// Http Client hooks
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

export * from "./descriptors/$action.ts";
export * from "./descriptors/$route.ts";
export * from "./helpers/ActionDescriptorHelper.ts";
export * from "./index.shared.ts";
export * from "./providers/features/ServerLoggerProvider.ts";
export * from "./providers/features/ServerNotReadyProvider.ts";
export * from "./providers/features/ServerSecurityProvider.ts";
export * from "./providers/features/ServerTimingProvider.ts";
export * from "./providers/platforms/NodeHttpServerProvider.ts";
export * from "./providers/platforms/ServerProvider.ts";
export * from "./providers/ServerActionDescriptorProvider.ts";
export * from "./providers/ServerRouterProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides high-performance HTTP server capabilities with declarative routing and action descriptors.
 *
 * The server module enables building REST APIs and web applications using `$route` and `$action` descriptors
 * on class properties. It provides automatic request/response handling, schema validation, middleware support,
 * and seamless integration with other Alepha modules for a complete backend solution.
 *
 * **Key Features:**
 * - Declarative route definition with `$route` descriptor
 * - API action handlers with `$action` descriptor
 * - Schema validation for requests and responses
 * - Automatic body parsing and response formatting
 * - Built-in middleware system and error handling
 * - Type-safe request parameters and response data
 * - Integration with authentication and security modules
 *
 * **Basic Routing:**
 * ```ts
 * import { Alepha, run, t } from "alepha";
 * import { AlephaServer, $route } from "alepha/server";
 *
 * class ApiRoutes {
 *   // Simple GET route
 *   getUsers = $route({
 *     path: "/api/users",
 *     method: "GET",
 *     handler: async () => {
 *       const users = await getAllUsers();
 *       return Response.json(users);
 *     },
 *   });
 *
 *   // POST route with body validation
 *   createUser = $route({
 *     path: "/api/users",
 *     method: "POST",
 *     schema: {
 *       body: t.object({
 *         name: t.string(),
 *         email: t.string(),
 *       }),
 *     },
 *     handler: async ({ body }) => {
 *       const user = await createUser(body);
 *       return Response.json(user, { status: 201 });
 *     },
 *   });
 *
 *   // Dynamic route with parameters
 *   getUserById = $route({
 *     path: "/api/users/:id",
 *     method: "GET",
 *     schema: {
 *       params: t.object({
 *         id: t.string(),
 *       }),
 *     },
 *     handler: async ({ params }) => {
 *       const user = await findUserById(params.id);
 *       if (!user) {
 *         return new Response("User not found", { status: 404 });
 *       }
 *       return Response.json(user);
 *     },
 *   });
 * }
 *
 * const alepha = Alepha.create()
 *   .with(AlephaServer)
 *   .with(ApiRoutes);
 *
 * run(alepha);
 * ```
 *
 * **Action Descriptors:**
 * ```ts
 * import { $action } from "alepha/server";
 *
 * class UserController {
 *   // Reusable business logic action
 *   getUserProfile = $action({
 *     schema: {
 *       params: t.object({
 *         userId: t.string(),
 *       }),
 *       response: t.object({
 *         id: t.string(),
 *         name: t.string(),
 *         email: t.string(),
 *       }),
 *     },
 *     handler: async ({ params }) => {
 *       const user = await getUserById(params.userId);
 *       return {
 *         id: user.id,
 *         name: user.name,
 *         email: user.email,
 *       };
 *     },
 *   });
 *
 *   // Route that uses the action
 *   profileRoute = $route({
 *     path: "/api/profile/:userId",
 *     method: "GET",
 *     handler: async ({ params }) => {
 *       const profile = await this.getUserProfile({ params });
 *       return Response.json(profile);
 *     },
 *   });
 * }
 * ```
 *
 * **Middleware and Error Handling:**
 * ```ts
 * class AppServer {
 *   // Global middleware
 *   middleware = $route({
 *     path: "*",
 *     method: "*",
 *     handler: async ({ request, next }) => {
 *       console.log(`${request.method} ${request.url}`);
 *       try {
 *         return await next();
 *       } catch (error) {
 *         console.error("Request failed:", error);
 *         return Response.json({ error: "Internal Server Error" }, { status: 500 });
 *       }
 *     },
 *   });
 *
 *   // CORS preflight handling
 *   corsPrelight = $route({
 *     path: "*",
 *     method: "OPTIONS",
 *     handler: async () => {
 *       return new Response(null, {
 *         status: 200,
 *         headers: {
 *           "Access-Control-Allow-Origin": "*",
 *           "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
 *           "Access-Control-Allow-Headers": "Content-Type, Authorization",
 *         },
 *       });
 *     },
 *   });
 * }
 * ```
 *
 * @see {@link $route}
 * @see {@link $action}
 * @module alepha.server
 */
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
