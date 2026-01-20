import { $env, $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $route } from "alepha/server";
import { McpUnauthorizedError } from "../errors/McpError.ts";
import {
  createErrorResponse,
  createNotification,
  createParseError,
  JsonRpcParseError,
  parseMessage,
} from "../helpers/jsonrpc.ts";
import type { McpContext } from "../interfaces/McpTypes.ts";
import type {
  McpAuthContext,
  McpAuthPrimitive,
} from "../primitives/$mcpAuth.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  MCP_SSE_PATH: t.text({
    description: "Path for MCP SSE endpoint",
    default: "/mcp",
  }),
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * SSE (Server-Sent Events) transport for MCP communication.
 *
 * This transport uses HTTP with SSE for server-to-client messages
 * and POST requests for client-to-server messages.
 *
 * Endpoints:
 * - GET /mcp - SSE stream for server events
 * - POST /mcp - JSON-RPC request endpoint
 *
 * @example
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { AlephaServer } from "alepha/server";
 * import { AlephaMcp, AlephaMcpSse } from "alepha/mcp";
 *
 * class MyTools {
 *   // ... tool definitions
 * }
 *
 * run(
 *   Alepha.create()
 *     .with(AlephaServer)
 *     .with(AlephaMcp)
 *     .with(AlephaMcpSse)
 *     .with(MyTools)
 * );
 * ```
 */
export class SseMcpTransport {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly mcpServer = $inject(McpServerProvider);
  protected readonly oauthClientService = $inject(OAuthClientService);

  /**
   * Optional MCP auth primitive for authentication.
   * Set this to enable authentication for MCP requests.
   */
  public mcpAuth?: McpAuthPrimitive;

  /**
   * SSE endpoint for server-to-client messages.
   *
   * Returns a text/event-stream response with server capabilities
   * and keeps the connection open for notifications.
   */
  sse = $route({
    method: "GET",
    path: this.env.MCP_SSE_PATH,
    handler: async (request) => {
      this.log.debug("MCP SSE connection established");

      const encoder = new TextEncoder();

      // Create SSE stream
      const stream = new ReadableStream({
        start: (controller) => {
          // Send initial endpoint info
          const endpointEvent = this.formatSseEvent(
            "endpoint",
            `${this.env.MCP_SSE_PATH}`,
          );
          controller.enqueue(encoder.encode(endpointEvent));

          // Send capabilities notification
          const capabilitiesNotification = createNotification(
            "notifications/capabilities",
            { capabilities: this.mcpServer.getCapabilities() },
          );
          const capabilitiesEvent = this.formatSseEvent(
            "message",
            JSON.stringify(capabilitiesNotification),
          );
          controller.enqueue(encoder.encode(capabilitiesEvent));
        },
        cancel: () => {
          this.log.debug("MCP SSE connection closed");
        },
      });

      request.reply.status = 200;
      request.reply.headers = {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      };
      request.reply.body = stream;
    },
  });

  /**
   * OAuth2 token endpoint for client credentials grant.
   */
  token = $route({
    method: "POST",
    path: `${this.env.MCP_SSE_PATH}/oauth/token`,
    secure: false,
    schema: {
      body: t.object({
        grant_type: t.text(),
        client_id: t.text(),
        client_secret: t.text(),
      }),
    },
    handler: async (request) => {
      try {
        const { grant_type, client_id, client_secret } = request.body;

        if (grant_type !== "client_credentials") {
          request.reply.status = 400;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify({
            error: "unsupported_grant_type",
            error_description:
              "Only client_credentials grant type is supported",
          });
          return;
        }

        if (!this.mcpAuth) {
          request.reply.status = 501;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify({
            error: "server_error",
            error_description: "MCP authentication is not configured",
          });
          return;
        }

        const tokenResponse = await this.mcpAuth.createClientToken(
          client_id,
          client_secret,
        );

        request.reply.status = 200;
        request.reply.headers["content-type"] = "application/json";
        request.reply.headers["cache-control"] = "no-store";
        request.reply.body = JSON.stringify(tokenResponse);
      } catch (error) {
        if (error instanceof McpUnauthorizedError) {
          request.reply.status = 401;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify({
            error: "invalid_client",
            error_description: error.message,
          });
        } else {
          this.log.error("Failed to issue token", error);
          request.reply.status = 500;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify({
            error: "server_error",
            error_description: (error as Error).message,
          });
        }
      }
    },
  });

  /**
   * POST endpoint for client-to-server JSON-RPC messages.
   */
  message = $route({
    method: "POST",
    path: this.env.MCP_SSE_PATH,
    secure: false,
    schema: {
      body: t.json(),
      query: t.object({
        token: t.optional(
          t.text({ description: "API token for authentication" }),
        ),
      }),
    },
    handler: async (request) => {
      try {
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

        // Support token as query parameter (for clients that can't set headers)
        if (request.query.token && !headers.authorization) {
          headers.authorization = `Bearer ${request.query.token}`;
        }

        const context: McpContext<McpAuthContext> = { headers };

        // Authenticate if mcpAuth is configured
        if (this.mcpAuth) {
          try {
            const authContext = await this.mcpAuth.authenticate(context);
            context.data = authContext;
          } catch (error) {
            if (error instanceof McpUnauthorizedError) {
              request.reply.status = 401;
              request.reply.headers["content-type"] = "application/json";
              request.reply.headers["www-authenticate"] = "Bearer";
              request.reply.body = JSON.stringify(
                createErrorResponse(rpcRequest.id ?? 0, {
                  code: -32001,
                  message: error.message,
                }),
              );
              return;
            }
            throw error;
          }
        }

        const response = await this.mcpServer.handleMessage(
          rpcRequest,
          context,
        );

        request.reply.headers["content-type"] = "application/json";
        request.reply.body = response ? JSON.stringify(response) : "";
      } catch (error) {
        if (error instanceof JsonRpcParseError) {
          request.reply.status = 400;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify(
            createErrorResponse(0, createParseError(error.message)),
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

  /**
   * Format a message as an SSE event.
   */
  protected formatSseEvent(event: string, data: string): string {
    return `event: ${event}\ndata: ${data}\n\n`;
  }
}
