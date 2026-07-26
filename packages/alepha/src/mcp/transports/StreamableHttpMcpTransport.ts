import { $atom, $inject, $state, z } from "alepha";
import { $logger } from "alepha/logger";
import { $route } from "alepha/server";
import {
  createErrorResponse,
  createParseError,
  isSupportedProtocolVersion,
  JsonRpcParseError,
  parseMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../helpers/jsonrpc.ts";
import type { McpContext } from "../interfaces/McpTypes.ts";
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

// Backward-compat alias for the legacy atom name. Prefer
// `mcpStreamableHttpOptions` going forward; this re-export keeps existing
// consumer imports compiling and will be removed once they migrate.
export const mcpSseOptions = mcpStreamableHttpOptions;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Streamable HTTP transport for MCP communication.
 *
 * Implements the 2025-03-26+ Streamable HTTP transport: a single `/mcp`
 * endpoint that accepts JSON-RPC over POST and returns either
 * `application/json` (single response, the default) or
 * `text/event-stream` (when the server wants to stream multiple messages).
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
  protected readonly options = $state(mcpStreamableHttpOptions);
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
    handler: (request) => {
      request.reply.status = 405;
      request.reply.headers.allow = "POST";
      request.reply.headers["content-type"] = "application/json";
      request.reply.body = JSON.stringify({
        error: "Method Not Allowed. Use POST for MCP messages.",
      });
    },
  });

  /**
   * POST endpoint for client-to-server JSON-RPC messages.
   * Returns `application/json` for single responses; tools that need to
   * stream progress would upgrade to `text/event-stream` (deferred until a
   * concrete need exists).
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

        // Build context from request headers
        const headers = { ...request.headers } as Record<
          string,
          string | string[] | undefined
        >;

        // Spec 2025-06-18+: every HTTP request after `initialize` MUST carry
        // an `MCP-Protocol-Version` header matching the negotiated version.
        // Reject mismatches with 400 so the client doesn't silently drift.
        if (rpcRequest.method !== "initialize") {
          const headerRaw = headers["mcp-protocol-version"];
          const headerVersion = Array.isArray(headerRaw)
            ? headerRaw[0]
            : headerRaw;
          // Validated against the SUPPORTED set, not against a single
          // negotiated value held on the provider singleton. That value is
          // process-global: client B initializing with an older version
          // changed what client A was checked against, and on Workers a fresh
          // isolate reset it — so a client that negotiated correctly started
          // getting 400s on its next request.
          if (headerVersion && !isSupportedProtocolVersion(headerVersion)) {
            this.log.warn("MCP-Protocol-Version header not supported", {
              header: headerVersion,
              supported: SUPPORTED_PROTOCOL_VERSIONS,
            });
            request.reply.status = 400;
            request.reply.headers["content-type"] = "application/json";
            request.reply.body = JSON.stringify({
              error: `MCP-Protocol-Version not supported: got ${headerVersion}, expected one of ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
            });
            return;
          }
        }

        const context: McpContext = { headers };

        const response = await this.mcpServer.handleMessage(
          rpcRequest,
          context,
        );

        if (response) {
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify(response);
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
}

/**
 * @deprecated Use {@link StreamableHttpMcpTransport}. The 2024-11-05
 * two-endpoint HTTP+SSE pattern was replaced by Streamable HTTP in spec
 * 2025-03-26. This alias is preserved for one release to ease migration.
 */
export const SseMcpTransport = StreamableHttpMcpTransport;
