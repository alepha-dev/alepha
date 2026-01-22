import type { Server } from "node:http";
import { $module, type Alepha, type PrimitiveFactoryLike } from "alepha";
import type { HttpError } from "./errors/HttpError.ts";
import type {
  NodeRequestEvent,
  RequestConfigSchema,
  ServerRequest,
  ServerRequestConfigEntry,
  ServerResponse,
  ServerRoute,
  WebRequestEvent,
} from "./interfaces/ServerRequest.ts";
import {
  $action,
  type ActionPrimitive,
  type ClientRequestOptions,
} from "./primitives/$action.ts";
import { $route } from "./primitives/$route.ts";
import { BunHttpServerProvider } from "./providers/BunHttpServerProvider.ts";
import { NodeHttpServerProvider } from "./providers/NodeHttpServerProvider.ts";
import { ServerBodyParserProvider } from "./providers/ServerBodyParserProvider.ts";
import { ServerLoggerProvider } from "./providers/ServerLoggerProvider.ts";
import { ServerNotReadyProvider } from "./providers/ServerNotReadyProvider.ts";
import { ServerProvider } from "./providers/ServerProvider.ts";
import { ServerRouterProvider } from "./providers/ServerRouterProvider.ts";
import { ServerTimingProvider } from "./providers/ServerTimingProvider.ts";
import type { FetchOptions, HttpAction } from "./services/HttpClient.ts";
import { HttpClient } from "./services/HttpClient.ts";
import { ServerRequestParser } from "./services/ServerRequestParser.ts";
import { UserAgentParser } from "./services/UserAgentParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    "alepha.node.server"?: Server;
  }
  interface Hooks {
    // -----------------------------------------------------------------------------------------------------------------
    // Local Actions hooks
    "action:onRequest": {
      action: ActionPrimitive<RequestConfigSchema>;
      request: ServerRequest;
      options: ClientRequestOptions;
    };
    "action:onResponse": {
      action: ActionPrimitive<RequestConfigSchema>;
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
    "node:request": NodeRequestEvent;
    "web:request": WebRequestEvent;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./primitives/$action.ts";
export * from "./primitives/$route.ts";
export * from "./providers/BunHttpServerProvider.ts";
export * from "./providers/NodeHttpServerProvider.ts";
export * from "./providers/ServerLoggerProvider.ts";
export * from "./providers/ServerNotReadyProvider.ts";
export * from "./providers/ServerProvider.ts";
export * from "./providers/ServerRouterProvider.ts";
export * from "./providers/ServerTimingProvider.ts";
export * from "./services/UserAgentParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides high-performance HTTP server capabilities with declarative routing and action primitives.
 *
 * The server module enables building REST APIs and web applications using `$route` and `$action` primitives
 * on class properties. It provides automatic request/response handling, schema validation, middleware support,
 * and seamless integration with other Alepha modules for a complete backend solution.
 *
 * @see {@link $route}
 * @see {@link $action}
 * @module alepha.server
 */
export const AlephaServer = $module({
  name: "alepha.server",
  primitives: [$route, $action as PrimitiveFactoryLike],
  services: [
    ServerProvider,
    BunHttpServerProvider,
    NodeHttpServerProvider,
    ServerBodyParserProvider,
    ServerLoggerProvider,
    ServerNotReadyProvider,
    ServerTimingProvider,
    HttpClient,
    UserAgentParser,
    ServerRequestParser,
    ServerRouterProvider,
  ],
  register: (alepha: Alepha) => {
    if (!alepha.isServerless()) {
      if (alepha.isBun()) {
        alepha.with({
          optional: true,
          provide: ServerProvider,
          use: BunHttpServerProvider,
        });
      } else {
        alepha.with({
          optional: true,
          provide: ServerProvider,
          use: NodeHttpServerProvider,
        });
      }
    } else {
      alepha.with(ServerProvider);
    }

    alepha.with(ServerBodyParserProvider);
    alepha.with(ServerLoggerProvider);
    alepha.with(ServerNotReadyProvider);

    if (!alepha.isProduction()) {
      alepha.with(ServerTimingProvider);
    }
  },
});
