import { $atom, $inject, $use, t } from "alepha";
import { $logger } from "alepha/logger";
import { $route } from "alepha/server";
import {
  createErrorResponse,
  createNotification,
  createParseError,
  JsonRpcParseError,
  parseMessage,
} from "../helpers/jsonrpc.ts";
import type { McpContext } from "../interfaces/McpTypes.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const mcpSseOptions = $atom({
  name: "alepha.mcp.sse.options",
  description: "Configuration options for the MCP SSE transport.",
  schema: t.object({
    /**
     * Path for the MCP SSE endpoint.
     */
    path: t.text({ default: "/mcp" }),
  }),
  default: {
    path: "/mcp",
  },
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
  protected readonly options = $use(mcpSseOptions);
  protected readonly mcpServer = $inject(McpServerProvider);

  /**
   * SSE endpoint for server-to-client messages.
   *
   * Returns a text/event-stream response with server capabilities
   * and keeps the connection open for notifications.
   */
  sse = $route({
    method: "GET",
    path: this.options.path,
    handler: async (request) => {
      this.log.debug("MCP SSE connection established");

      const encoder = new TextEncoder();

      // Create SSE stream
      const stream = new ReadableStream({
        start: (controller) => {
          // Send initial endpoint info
          const endpointEvent = this.formatSseEvent(
            "endpoint",
            `${this.options.path}`,
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
   * POST endpoint for client-to-server JSON-RPC messages.
   */
  message = $route({
    method: "POST",
    path: this.options.path,
    schema: {
      body: t.json(),
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

        const context: McpContext = { headers };

        const response = await this.mcpServer.handleMessage(
          rpcRequest,
          context,
        );

        if (response) {
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify(response);
        } else {
          request.reply.status = 204;
        }
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
