import type { Server } from "node:http";
import { $module, type Alepha } from "alepha";
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
import { $middleware } from "./primitives/$middleware.ts";
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
export * from "./primitives/$circuit.ts";
export * from "./primitives/$middleware.ts";
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
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.1.0 | node, bun, workerd|
 *
 * Convention-driven HTTP server with automatic validation and type inference.
 *
 * **Features:**
 * - Type-safe API endpoints with schema validation
 * - Lower-level HTTP route definitions
 * - Automatic request/response validation via TypeBox
 * - Convention-based URL generation (`/api/{ActionName}`)
 * - Direct invocation (`run()`) or HTTP (`fetch()`)
 * - Built-in authentication integration
 * - Multipart file upload handling
 * - Content-type auto-negotiation (JSON, form-data, text)
 * - HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
 * - Error handling: BadRequestError, ValidationError, ForbiddenError, UnauthorizedError, ConflictError, NotFoundError
 *
 * @module alepha.server
 */
export const AlephaServer = $module({
  name: "alepha.server",
  primitives: [$route, $action, $middleware],
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
    // In Vite dev mode, Vite owns the HTTP server - just use base ServerProvider
    // In serverless mode, no HTTP server needed - just use base ServerProvider
    if (!alepha.isServerless() && !alepha.isViteDev()) {
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
