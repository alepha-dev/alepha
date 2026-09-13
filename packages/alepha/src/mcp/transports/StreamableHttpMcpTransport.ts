import { $atom, $inject, $store, z } from "alepha";
import { $logger } from "alepha/logger";
import { $route } from "alepha/server";

import {
  McpHeaderMismatchError,
  McpMethodNotFoundError,
} from "../errors/McpError.ts";
import {
  createErrorResponse,
  createInternalError,
  createNotification,
  createParseError,
  JsonRpcErrorCodes,
  JsonRpcParseError,
  McpProtocolErrorCodes,
  parseMessage,
} from "../helpers/jsonrpc.ts";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpContext,
} from "../interfaces/McpTypes.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const mcpStreamableHttpOptions = $atom({
  name: "alepha.mcp.streamableHttp.options",
  description: "Configuration options for the MCP Streamable HTTP transport.",
  schema: z.object({
    /**
     * Path for the MCP endpoint. Single endpoint for both requests and
     * (optional) server-streamed responses, per spec 2025-03-26+.
     */
    path: z.text({ default: "/mcp" }),
    /**
     * Allow-list of `Origin` header values accepted on incoming requests.
     * Empty array (default) means "allow any". When set, browser-originated
     * requests with a non-matching `Origin` are rejected with 403 Forbidden,
     * blocking DNS-rebinding attacks against localhost MCP servers.
     *
     * Server-to-server callers (no `Origin` header) are always allowed.
     *
     * Spec 2025-11-25, PR #1439.
     */
    allowedOrigins: z.array(z.text()).default([]),
    /**
     * When true, an unauthenticated POST to the MCP endpoint is rejected
     * with `401 Unauthorized` and an RFC 9728 `WWW-Authenticate` challenge
     * instead of being dispatched. MCP clients (Claude, etc.) rely on that
     * challenge to discover the OAuth authorization server.
     *
     * The transport stays OAuth-agnostic: it only knows "auth is required".
     * `$realm({ features: { oauth: true } })` flips this on automatically.
     *
     * @default false
     */
    requireAuth: z.boolean().default(false),
    /**
     * Path of the RFC 9728 protected-resource metadata document, advertised
     * (as an absolute URL, resolved against the request origin) in the
     * `WWW-Authenticate` challenge emitted when {@link requireAuth} rejects
     * a request.
     */
    resourceMetadataPath: z.text({
      default: "/.well-known/oauth-protected-resource",
    }),
  }),
  default: {
    path: "/mcp",
    allowedOrigins: [],
    requireAuth: false,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  },
  serverOnly: true,
});

/**
 * Alias kept for the atom's former name. Prefer `mcpStreamableHttpOptions`;
 * this export keeps existing imports compiling and goes once they migrate.
 */
export const mcpSseOptions = mcpStreamableHttpOptions;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Streamable HTTP transport for MCP communication.
 *
 * Implements the 2025-03-26+ Streamable HTTP transport: a single `/mcp`
 * endpoint that accepts JSON-RPC over POST and returns either
 * `application/json` (single response, the default) or `text/event-stream`
 * (when the client asked for progress via `_meta.progressToken`).
 *
 * Designed for serverless deployment (Cloudflare Workers, etc.) — there is
 * no long-lived GET stream. GET on the endpoint returns 405 Method Not
 * Allowed; clients that want server-initiated push must rely on the POST
 * response stream when the server upgrades to SSE for that particular call.
 *
 * Spec compliance:
 * - 2025-06-18: validates `MCP-Protocol-Version` header on every request
 *   after `initialize` against the version negotiated and stored on
 *   `McpServerProvider`.
 * - 2025-11-25: rejects requests with a non-allow-listed `Origin` header
 *   (PR #1439). See {@link mcpStreamableHttpOptions.allowedOrigins}.
 *
 * @example
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { AlephaServer } from "alepha/server";
 * import { AlephaMcp, StreamableHttpMcpTransport } from "alepha/mcp";
 *
 * class MyTools {
 *   // ... tool definitions
 * }
 *
 * run(
 *   Alepha.create()
 *     .with(AlephaServer)
 *     .with(AlephaMcp)
 *     .with(StreamableHttpMcpTransport)
 *     .with(MyTools)
 * );
 * ```
 */
export class StreamableHttpMcpTransport {
  protected readonly log = $logger();
  protected readonly options = $store(mcpStreamableHttpOptions);
  protected readonly mcpServer = $inject(McpServerProvider);

  /**
   * GET on the MCP endpoint is not supported in this transport. Returning
   * 405 (rather than serving the legacy two-endpoint SSE pattern) is the
   * spec-allowed response for servers that don't offer server-initiated
   * push outside of an active POST.
   */
  notAllowed = $route({
    method: "GET",
    path: this.options.path,
    handler: (request) => this.replyNotAllowed(request),
  });

  /**
   * DELETE is how a 2025-03-26..2025-11-25 client ends a session. This server
   * never mints one, and 2026-07-28 says a GET or DELETE on the endpoint
   * SHOULD get 405, so it gets the same answer as GET instead of a 404 that
   * reads like a missing endpoint.
   */
  notAllowedDelete = $route({
    method: "DELETE",
    path: this.options.path,
    handler: (request) => this.replyNotAllowed(request),
  });

  /**
   * POST endpoint for client-to-server JSON-RPC messages.
   *
   * Returns `application/json` for single responses. When the client attaches
   * a `_meta.progressToken`, the response upgrades to `text/event-stream`:
   * `notifications/progress` as the handler reports them, then the final
   * JSON-RPC response, then close.
   */
  message = $route({
    method: "POST",
    path: this.options.path,
    schema: {
      body: z.json(),
    },
    handler: async (request) => {
      try {
        // Origin allow-list check (spec 2025-11-25 / PR #1439).
        const originRaw = request.headers.origin;
        const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
        if (
          origin &&
          this.options.allowedOrigins.length > 0 &&
          !this.options.allowedOrigins.includes(origin)
        ) {
          this.log.warn("Rejected MCP request with non-allowed Origin", {
            origin,
            allowed: this.options.allowedOrigins,
          });
          request.reply.status = 403;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify({
            error: "Forbidden: Origin not allowed",
          });
          return;
        }

        // RFC 9728 / MCP auth (spec 2025-06-18+): when the endpoint is
        // OAuth-protected, an unauthenticated request is rejected with 401
        // and a `WWW-Authenticate` challenge pointing at the protected-
        // resource metadata. MCP clients (Claude, etc.) follow that
        // `resource_metadata` URL to discover the authorization server —
        // without it, discovery never starts. The URL MUST be absolute.
        if (this.options.requireAuth && !request.user) {
          const url =
            typeof request.url === "string"
              ? new URL(request.url)
              : request.url;
          const resourceMetadataUrl = `${url.protocol}//${url.host}${this.options.resourceMetadataPath}`;
          this.log.debug("Rejecting unauthenticated MCP request", {
            resourceMetadataUrl,
          });
          request.reply.status = 401;
          request.reply.headers["www-authenticate"] =
            `Bearer resource_metadata="${resourceMetadataUrl}"`;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify({
            error: "Unauthorized",
          });
          return;
        }

        const body =
          typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body);

        this.log.debug("MCP request body", {
          body,
          bodyType: typeof request.body,
        });

        const rpcRequest = parseMessage(body);

        const headers = { ...request.headers } as Record<
          string,
          string | string[] | undefined
        >;

        // The era is decided per request, by the provider, from the version
        // the request carries. `undefined` is a legacy request, and always is
        // while the modern path is off.
        const modern = this.mcpServer.resolveModernRequest(rpcRequest, headers);

        // Legacy, spec 2025-06-18+: every HTTP request after `initialize` MUST
        // carry an `MCP-Protocol-Version` header matching the negotiated
        // version. Reject one this server does not serve with 400 so the
        // client doesn't silently drift.
        if (!modern && rpcRequest.method !== "initialize") {
          const headerVersion = this.firstHeader(
            headers,
            "mcp-protocol-version",
          );
          const supported = this.mcpServer.protocolVersions;
          // Validated against the SUPPORTED set, not against a single
          // negotiated value held on the provider singleton. That value is
          // process-global: client B initializing with an older version
          // changed what client A was checked against, and on Workers a fresh
          // isolate reset it — so a client that negotiated correctly started
          // getting 400s on its next request.
          if (headerVersion && !supported.includes(headerVersion)) {
            // INFO, not WARN: nothing is wrong. A dual-era client (claude.ai)
            // probes with a modern version on every connection and falls back
            // on this answer, so at WARN it was the second most frequent line
            // on Lore and buried the real warnings. INFO still reaches
            // production, where the shape below is the only record of what a
            // modern client actually sends.
            this.log.info("MCP-Protocol-Version header not supported", {
              header: headerVersion,
              supported,
              ...this.describeRequestShape(rpcRequest, headers),
            });
            request.reply.status = 400;
            request.reply.headers["content-type"] = "application/json";
            // ⚠️ Load-bearing: this body must NOT be a JSON-RPC error. Per the
            // 2026-07-28 Streamable HTTP backward-compatibility rule, a client
            // falls back to `initialize` only when a 400's body is not a
            // recognized modern JSON-RPC error. A `-32022` here would tell
            // claude.ai this server is modern, and it would stop falling back.
            // Only a modern request gets the modern error, below, and a request
            // is only ever modern while the modern path is on.
            request.reply.body = JSON.stringify({
              error: `MCP-Protocol-Version not supported: got ${headerVersion}, expected one of ${supported.join(", ")}`,
            });
            return;
          }
        }

        // Modern: a request that cannot be served at all is answered before
        // anything is routed, and before a response stream could open and
        // commit the status to 200. In the spec's order: headers that
        // disagree with the body (-32020), then a version this server does
        // not serve (-32022), then a method it does not implement (-32601).
        if (modern && rpcRequest.id !== undefined) {
          const rejection =
            this.validateModernHeaders(rpcRequest, headers) ??
            this.mcpServer.checkModernRequest(modern) ??
            (this.mcpServer.handlesMethod(rpcRequest.method, true)
              ? undefined
              : new McpMethodNotFoundError(rpcRequest.method));
          if (rejection) {
            this.log.info("MCP modern request rejected", {
              code: rejection.code,
              message: rejection.message,
              ...this.describeRequestShape(rpcRequest, headers),
            });
            return this.replyJson(
              request,
              createErrorResponse(rpcRequest.id, {
                code: rejection.code,
                message: rejection.message,
                data: rejection.data,
              }),
              true,
            );
          }
        }

        const progressToken = this.progressToken(rpcRequest);
        if (progressToken !== undefined && this.acceptsEventStream(headers)) {
          return this.streamResponse(request, rpcRequest, progressToken);
        }

        const response = await this.mcpServer.handleMessage(
          rpcRequest,
          this.buildContext(request),
        );

        if (response) {
          this.replyJson(request, response, !!modern);
        } else {
          // Spec: a notification "MUST return HTTP 202 Accepted".
          request.reply.status = 202;
        }
      } catch (error) {
        if (error instanceof JsonRpcParseError) {
          request.reply.status = 400;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify(
            // `null`, per JSON-RPC: the id could not be determined. `0` both
            // violated the spec and could collide with a real id of 0.
            createErrorResponse(null, createParseError(error.message)),
          );
        } else {
          this.log.error("Failed to process MCP message", error);
          request.reply.status = 500;
          request.reply.body = JSON.stringify({
            error: (error as Error).message,
          });
        }
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------
  // Responses
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Send one JSON-RPC response as `application/json`, with the HTTP status its
   * era gives it.
   */
  protected replyJson(
    request: any,
    response: JsonRpcResponse,
    modern: boolean,
  ): void {
    request.reply.status = this.httpStatusFor(response, modern);
    request.reply.headers["content-type"] = "application/json";
    request.reply.body = JSON.stringify(response);
  }

  /**
   * The HTTP status of a JSON-RPC response.
   *
   * Legacy responses are always 200, errors included: that is what legacy
   * clients have always received. A modern (2026-07-28) request that fails for
   * a protocol reason gets the status the spec gives that reason, which is
   * how an intermediary that never parses the body still sees the failure.
   * Every other JSON-RPC error, a tool not found included, stays 200.
   */
  protected httpStatusFor(response: JsonRpcResponse, modern: boolean): number {
    if (!modern || !response.error) {
      return 200;
    }
    switch (response.error.code) {
      case McpProtocolErrorCodes.HEADER_MISMATCH:
      case McpProtocolErrorCodes.UNSUPPORTED_PROTOCOL_VERSION:
        return 400;
      case JsonRpcErrorCodes.METHOD_NOT_FOUND:
        // Distinguishes "this modern endpoint has no such method" from a 404
        // by a legacy HTTP+SSE server that does not host the endpoint at all:
        // the JSON-RPC body is what tells a client which one it hit.
        return 404;
      default:
        return 200;
    }
  }

  /**
   * 405 for a method the endpoint does not accept.
   */
  protected replyNotAllowed(request: any): void {
    request.reply.status = 405;
    request.reply.headers.allow = "POST";
    request.reply.headers["content-type"] = "application/json";
    request.reply.body = JSON.stringify({
      error: "Method Not Allowed. Use POST for MCP messages.",
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Request metadata headers (2026-07-28)
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Check a modern request's mirrored headers against its body, strictly
   * (spec 2026-07-28, Streamable HTTP "Server Validation").
   *
   * - `MCP-Protocol-Version` is required and must equal `_meta`'s
   *   `io.modelcontextprotocol/protocolVersion`.
   * - `Mcp-Method` is required and must equal `method`.
   * - `Mcp-Name` is required on `tools/call` and `prompts/get` (equal to
   *   `params.name`) and on `resources/read` (equal to `params.uri`), after
   *   decoding a `=?base64?...?=` value.
   *
   * Header names are case-insensitive (the runtime lower-cases them), values
   * case-sensitive. Never applied to a legacy request, whatever `Mcp-*`
   * headers it carries.
   *
   * Strict rather than lenient on a missing header on purpose: leniency is
   * invisible once shipped, and a request that routes one way on its headers
   * and executes another way on its body is exactly what this check exists to
   * refuse.
   */
  protected validateModernHeaders(
    rpcRequest: JsonRpcRequest,
    headers: Record<string, string | string[] | undefined>,
  ): McpHeaderMismatchError | undefined {
    const version = this.firstHeader(headers, "mcp-protocol-version");
    if (version === undefined) {
      return new McpHeaderMismatchError(
        "missing required MCP-Protocol-Version header",
      );
    }
    const meta = rpcRequest.params?._meta as
      | Record<string, unknown>
      | undefined;
    const bodyVersion = meta?.["io.modelcontextprotocol/protocolVersion"];
    if (version !== bodyVersion) {
      return new McpHeaderMismatchError(
        `MCP-Protocol-Version header value '${version}' does not match body value '${String(bodyVersion)}'`,
      );
    }

    const method = this.firstHeader(headers, "mcp-method");
    if (method === undefined) {
      return new McpHeaderMismatchError("missing required Mcp-Method header");
    }
    if (method !== rpcRequest.method) {
      return new McpHeaderMismatchError(
        `Mcp-Method header value '${method}' does not match body value '${rpcRequest.method}'`,
      );
    }

    const nameField = this.mcpNameField(rpcRequest.method);
    if (nameField === undefined) {
      return undefined;
    }
    const raw = this.firstHeader(headers, "mcp-name");
    if (raw === undefined) {
      return new McpHeaderMismatchError(
        `missing required Mcp-Name header for ${rpcRequest.method}`,
      );
    }
    const name = this.decodeHeaderValue(raw);
    if (name === undefined) {
      return new McpHeaderMismatchError("malformed Mcp-Name header value");
    }
    const bodyName = rpcRequest.params?.[nameField];
    if (name !== bodyName) {
      return new McpHeaderMismatchError(
        `Mcp-Name header value '${name}' does not match body value '${String(bodyName)}'`,
      );
    }
    return undefined;
  }

  /**
   * The body field `Mcp-Name` mirrors for a method, when it requires one.
   */
  protected mcpNameField(method: string): "name" | "uri" | undefined {
    switch (method) {
      case "tools/call":
      case "prompts/get":
        return "name";
      case "resources/read":
        return "uri";
      default:
        return undefined;
    }
  }

  /**
   * A mirrored header value as the body holds it: a `=?base64?...?=` sentinel
   * is decoded (Base64 of UTF-8, case-sensitive markers), anything else is
   * taken as is. `undefined` when the value is not a valid header value or
   * the sentinel does not decode.
   */
  protected decodeHeaderValue(value: string): string | undefined {
    // Visible ASCII, space and tab only (RFC 9110). Anything else should
    // have been sent as a sentinel.
    if (!/^[\t\x20-\x7e]*$/.test(value)) {
      return undefined;
    }
    const prefix = "=?base64?";
    const suffix = "?=";
    if (
      value.length < prefix.length + suffix.length ||
      !value.startsWith(prefix) ||
      !value.endsWith(suffix)
    ) {
      return value;
    }
    const encoded = value.slice(prefix.length, -suffix.length);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return undefined;
    }
    try {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------------------------------------------

  /**
   * The protocol-level shape of a request, safe to log in production.
   *
   * The routing headers and the `_meta` a client attaches: the JSON-RPC
   * method, `Mcp-Method` and `Mcp-Name`, which `_meta` keys are present, and
   * the values of the two that identify the client (`protocolVersion`,
   * `clientInfo`). Never `params.arguments`, and never any other `_meta`
   * value: this runs on whatever method arrives, and a `tools/call` carries
   * user data in both places.
   */
  protected describeRequestShape(
    rpcRequest: JsonRpcRequest,
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, unknown> {
    const raw = rpcRequest.params?._meta;
    const meta =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    return {
      method: rpcRequest.method,
      mcpMethod: this.firstHeader(headers, "mcp-method"),
      mcpName: this.firstHeader(headers, "mcp-name"),
      metaKeys: meta ? Object.keys(meta) : undefined,
      metaProtocolVersion: meta?.["io.modelcontextprotocol/protocolVersion"],
      metaClientInfo: meta?.["io.modelcontextprotocol/clientInfo"],
    };
  }

  /**
   * One header's value, the first when it was sent several times.
   */
  protected firstHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const raw = headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
  }

  // -------------------------------------------------------------------------------------------------------------
  // SSE response streaming
  // -------------------------------------------------------------------------------------------------------------

  /**
   * The progress token the client attached to this request, if any.
   *
   * This is what decides whether the response streams. A progress notification
   * is *addressed* to a token, so a request without one has nothing to stream
   * — plain JSON stays the default, and every client that does not ask for
   * progress sees exactly the behaviour it saw before.
   */
  protected progressToken(rpcRequest: {
    params?: Record<string, unknown>;
  }): string | number | undefined {
    const meta = rpcRequest.params?._meta as
      | { progressToken?: unknown }
      | undefined;
    const token = meta?.progressToken;
    return typeof token === "string" || typeof token === "number"
      ? token
      : undefined;
  }

  /**
   * Whether the client is willing to read an event stream. Clients are
   * supposed to accept both, but one that explicitly listed only JSON gets
   * JSON — an unreadable response is worse than a missing progress report.
   */
  protected acceptsEventStream(
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const raw = headers.accept;
    const accept = Array.isArray(raw) ? raw.join(",") : raw;
    if (!accept) {
      return true;
    }
    return (
      accept.includes("text/event-stream") ||
      accept.includes("*/*") ||
      accept.includes("application/*")
    );
  }

  /**
   * Answer with `text/event-stream`: progress notifications as they happen,
   * then the final JSON-RPC response, then close.
   */
  protected streamResponse(
    request: any,
    rpcRequest: JsonRpcRequest,
    progressToken: string | number,
  ): ReadableStream {
    request.reply.headers["content-type"] = "text/event-stream";
    request.reply.headers["cache-control"] = "no-cache";
    request.reply.headers.connection = "keep-alive";
    // Without this nginx buffers the whole response and delivers it at the
    // end, which defeats the entire point of streaming progress.
    request.reply.headers["x-accel-buffering"] = "no";

    const encoder = new TextEncoder();
    const context = this.buildContext(request);

    return new ReadableStream({
      start: (controller) => {
        let open = true;
        const send = (message: unknown): void => {
          if (!open) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(message)}\n\n`),
            );
          } catch {
            // The stream is already gone; nothing useful left to do.
            open = false;
          }
        };

        const streamContext: McpContext = {
          ...context,
          reportProgress: (progress, total, message) =>
            send(
              createNotification("notifications/progress", {
                progressToken,
                progress,
                ...(total !== undefined ? { total } : {}),
                ...(message !== undefined ? { message } : {}),
              }),
            ),
        };

        this.mcpServer
          .handleMessage(rpcRequest, streamContext)
          .then((response) => {
            // A cancelled request yields null: no final message, just the
            // close. The client asked us to forget it.
            if (response) {
              send(response);
            }
          })
          .catch((error: Error) => {
            this.log.error("Failed to process streamed MCP message", error);
            send(
              createErrorResponse(
                rpcRequest.id ?? null,
                createInternalError(error.message),
              ),
            );
          })
          .finally(() => {
            open = false;
            try {
              controller.close();
            } catch {
              // Already closed.
            }
          });
      },
      // The runtime cancels the stream when the client disconnects. Under
      // 2026-07-28 that IS the cancellation signal, so route it to the same
      // place `notifications/cancelled` goes.
      cancel: () => {
        if (rpcRequest.id !== undefined) {
          this.mcpServer.cancelRequest(rpcRequest.id, context.clientKey);
        }
      },
    });
  }

  /**
   * Build the {@link McpContext} handed to every tool, resource and prompt
   * handler for this request.
   *
   * `data` defaults to the authenticated user — the thing `requireAuth`
   * already gates on but, until this hook existed, never forwarded. Handlers
   * had a documented `context.data` that was `undefined` in production no
   * matter what; the only code exercising it was unit tests calling
   * `primitive.execute(args, { data })` directly, which proves nothing about
   * the real path.
   *
   * Override in a subclass to carry anything else the handlers need:
   *
   * ```ts
   * class MyMcpTransport extends StreamableHttpMcpTransport {
   *   protected buildContext(request: any) {
   *     return { ...super.buildContext(request), data: { tenant: request.headers.host } };
   *   }
   * }
   *
   * alepha.with({ provide: StreamableHttpMcpTransport, use: MyMcpTransport });
   * ```
   */
  protected buildContext(request: {
    headers: Record<string, any>;
    user?: unknown;
  }): McpContext {
    return {
      headers: { ...request.headers },
      data: request.user,
      clientKey: this.buildClientKey(request),
    };
  }

  /**
   * Identify the caller well enough to correlate a request with the
   * `notifications/cancelled` that cancels it — the two arrive as separate
   * POSTs and the only thing linking them is the JSON-RPC id, which is unique
   * per connection, not globally.
   *
   * `Mcp-Session-Id` is used when the client sends one. It is a hint, not a
   * credential: a caller who forges another's key can only cancel a request
   * whose id it also guesses, and nothing else keys off this value. An app
   * with authenticated MCP clients should override this to return the user id,
   * which removes the guess entirely.
   */
  protected buildClientKey(request: {
    headers: Record<string, any>;
  }): string | undefined {
    const raw = request.headers["mcp-session-id"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? value : undefined;
  }
}
