import * as readline from "node:readline";
import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import {
  createErrorResponse,
  createParseError,
  JsonRpcParseError,
  parseMessage,
} from "../helpers/jsonrpc.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Stdio transport for MCP communication.
 *
 * This transport uses stdin/stdout for JSON-RPC message exchange,
 * which is the standard transport for local MCP servers.
 *
 * Messages are newline-delimited JSON objects.
 *
 * @example
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { AlephaMcp, AlephaMcpStdio } from "alepha/mcp";
 *
 * class MyTools {
 *   // ... tool definitions
 * }
 *
 * run(
 *   Alepha.create()
 *     .with(AlephaMcp)
 *     .with(AlephaMcpStdio)
 *     .with(MyTools)
 * );
 * ```
 */
export class StdioMcpTransport {
  protected readonly log = $logger();
  protected readonly mcpServer = $inject(McpServerProvider);

  protected rl?: readline.Interface;
  protected started = false;

  onStart = $hook({
    on: "start",
    handler: () => this.start(),
  });

  onStop = $hook({
    on: "stop",
    handler: () => this.stop(),
  });

  /**
   * Start the stdio transport.
   */
  protected start(): void {
    if (this.started) return;
    this.started = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on("line", (line) => this.handleLine(line));
    this.rl.on("close", () => this.handleClose());

    this.log.info("MCP stdio transport started");
  }

  /**
   * Stop the stdio transport.
   */
  protected stop(): void {
    if (!this.started) return;
    this.started = false;

    this.rl?.close();
    this.rl = undefined;

    this.log.info("MCP stdio transport stopped");
  }

  /**
   * Handle an incoming line from stdin.
   */
  protected async handleLine(line: string): Promise<void> {
    // Skip empty lines
    if (!line.trim()) return;

    try {
      const request = parseMessage(line);
      const response = await this.mcpServer.handleMessage(request);

      if (response) {
        this.send(response);
      }
    } catch (error) {
      if (error instanceof JsonRpcParseError) {
        // Send parse error response
        this.send(createErrorResponse(0, createParseError(error.message)));
      } else {
        this.log.error("Failed to process MCP message", error);
      }
    }
  }

  /**
   * Handle stdin close event.
   */
  protected handleClose(): void {
    this.log.debug("MCP stdio input closed");
  }

  /**
   * Send a message to stdout.
   */
  protected send(message: object): void {
    const json = JSON.stringify(message);
    process.stdout.write(json + "\n");
  }
}
