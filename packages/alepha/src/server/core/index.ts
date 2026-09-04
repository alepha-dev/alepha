import type { Server } from "node:http";

import { $module, type Alepha } from "alepha";

import { versionOptions } from "./atoms/versionOptions.ts";
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
import { $sse } from "./primitives/$sse.ts";
import { BunHttpServerProvider } from "./providers/BunHttpServerProvider.ts";
import { NodeHttpServerProvider } from "./providers/NodeHttpServerProvider.ts";
import { ServerBodyParserProvider } from "./providers/ServerBodyParserProvider.ts";
import { ServerCompressProvider } from "./providers/ServerCompressProvider.ts";
import { ServerHealthProvider } from "./providers/ServerHealthProvider.ts";
import { ServerHelmetProvider } from "./providers/ServerHelmetProvider.ts";
import { ServerLoggerProvider } from "./providers/ServerLoggerProvider.ts";
import { ServerMultipartProvider } from "./providers/ServerMultipartProvider.ts";
import { ServerNotReadyProvider } from "./providers/ServerNotReadyProvider.ts";
import { ServerProvider } from "./providers/ServerProvider.ts";
import { ServerRouterProvider } from "./providers/ServerRouterProvider.ts";
import { ServerTimingProvider } from "./providers/ServerTimingProvider.ts";
import { ServerVersionProvider } from "./providers/ServerVersionProvider.ts";
import type {
  HttpAction,
  ResolvedFetchOptions,
} from "./services/HttpClient.ts";
import { HttpClient } from "./services/HttpClient.ts";
import { LogRedaction } from "./services/LogRedaction.ts";
import { ServerRequestParser } from "./services/ServerRequestParser.ts";
import { UserAgentParser } from "./services/UserAgentParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    "alepha.node.server"?: Server;
    "alepha.http.request"?: ServerRequest;
    "alepha.action.request"?: ServerRequest;
  }
  interface Hooks {
    // -----------------------------------------------------------------------------------------------------------------
    // Local Actions hooks
    "action:onRequest": {
      action: ActionPrimitive<RequestConfigSchema>;
      request: ServerRequest;
      options: ClientRequestOptions;
      context?: Record<string, any>;
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
      options: ResolvedFetchOptions;
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
export * from "./primitives/$middleware.ts";
export * from "./primitives/$route.ts";
export * from "./primitives/$sse.ts";
export * from "./providers/BunHttpServerProvider.ts";
export * from "./providers/NodeHttpServerProvider.ts";
export * from "./providers/ServerBodyParserProvider.ts";
export * from "./providers/ServerCompressProvider.ts";
export * from "./atoms/versionOptions.ts";
export * from "./providers/ServerHealthProvider.ts";
export * from "./providers/ServerVersionProvider.ts";
export * from "./providers/ServerHelmetProvider.ts";
export * from "./providers/ServerLoggerProvider.ts";
export * from "./providers/ServerMultipartProvider.ts";
export * from "./providers/ServerNotReadyProvider.ts";
export * from "./providers/ServerProvider.ts";
export * from "./providers/ServerRouterProvider.ts";
export * from "./providers/ServerTimingProvider.ts";
export * from "./services/UserAgentParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Convention-driven HTTP server with automatic validation and type inference.
 *
 * **Features:**
 * - Type-safe API endpoints with schema validation
 * - Lower-level HTTP route definitions
 * - Automatic request/response validation via Zod
 * - Convention-based URL generation (`/api/{ActionName}`)
 * - Direct invocation (`run()`) or HTTP (`fetch()`)
 * - Built-in authentication integration
 * - Multipart file upload handling
 * - Response compression (gzip, brotli, zstd)
 * - Security headers (HSTS, CSP, X-Frame-Options, etc.)
 * - Content-type auto-negotiation (JSON, form-data, text)
 * - HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
 * - Error handling: BadRequestError, ValidationError, ForbiddenError, UnauthorizedError, ConflictError, NotFoundError
 *
 * @module alepha.server
 */
/**
 * The outbound HTTP client, owned by nothing that serves.
 *
 * `HttpClient` used to live in {@link AlephaServer}'s `services`, and
 * `Alepha.inject` auto-registers a service's owning module - so injecting an
 * OUTBOUND client registered an inbound HTTP listener, and every consumer
 * (a CLI, a script, a worker) silently bound a port on `start()`.
 *
 * @module alepha.http
 */
export const AlephaHttpClient = $module({
  name: "alepha.http",
  // `LogRedaction` is registered beside `HttpClient` rather than in
  // `AlephaServer`, because both of its consumers need it and only one of
  // them serves: `HttpClient` traces outbound requests in the browser too,
  // and `AlephaServer` imports this module, so `ServerLoggerProvider`
  // reaches it from here.
  services: [HttpClient, LogRedaction],
});

export const AlephaServer = $module({
  name: "alepha.server",
  primitives: [$route, $action, $middleware, $sse],
  atoms: [versionOptions],
  imports: [AlephaHttpClient],
  services: [
    ServerBodyParserProvider,
    ServerCompressProvider,
    ServerHealthProvider,
    ServerVersionProvider,
    ServerHelmetProvider,
    ServerMultipartProvider,
    UserAgentParser,
    ServerRequestParser,
    ServerRouterProvider,
  ],
  variants: [
    ServerProvider,
    BunHttpServerProvider,
    NodeHttpServerProvider,
    ServerLoggerProvider,
    ServerNotReadyProvider,
    ServerTimingProvider,
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

    if (!alepha.isTest()) {
      alepha.with(ServerLoggerProvider);
      alepha.with(ServerNotReadyProvider);
    }

    if (!alepha.isProduction()) {
      alepha.with(ServerTimingProvider);
    }
  },
});
