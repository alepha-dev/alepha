import { $hook, $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import {
  createErrorResponse,
  createParseError,
  JsonRpcParseError,
  parseMessage,
} from "../helpers/jsonrpc.ts";
import type { JsonRpcResponse, McpContext } from "../interfaces/McpTypes.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * stdio transport for MCP — newline-delimited JSON-RPC over stdin/stdout.
 *
 * This is how every *local* MCP client talks to a server: Claude Desktop,
 * Claude Code and the rest launch the server as a subprocess and speak
 * JSON-RPC over its pipes. Without it an Alepha MCP server can only be reached
 * over HTTP, which most local clients will not do.
 *
 * **stdout belongs to the protocol.** One stray `console.log` — from your code,
 * from Alepha's logger, from any dependency — lands in the middle of a JSON-RPC
 * message and corrupts the stream permanently. So while this transport is
 * running it takes stdout away: `process.stdout.write` is redirected to stderr
 * for the lifetime of the server, and only this class writes protocol messages
 * to the real one. Diagnostics keep working; they just arrive on stderr, which
 * is exactly where the MCP spec says to put them.
 *
 * Opt-in, like every transport:
 *
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { AlephaMcp, StdioMcpTransport } from "alepha/mcp";
 *
 * run(Alepha.create().with(AlephaMcp).with(StdioMcpTransport).with(MyTools));
 * ```
 *
 * Per spec a stdio server takes its credentials from the environment rather
 * than the HTTP authorization framework, so `requireAuth` has no meaning here —
 * whoever launched the process is the caller.
 */
export class StdioMcpTransport {
  protected readonly log = $logger();
  protected readonly mcpServer = $inject(McpServerProvider);

  /** Bytes read from stdin that do not yet form a complete line. */
  protected buffer = "";

  /**
   * The real `process.stdout.write`, captured before stdout is redirected.
   * The only way anything reaches the client.
   */
  protected stdoutWrite?: (chunk: string) => void;

  /** Restores `process.stdout.write` on stop. */
  protected restoreStdout?: () => void;

  protected onLine = (line: string): void => {
    void this.handleLine(line);
  };

  protected onData = (chunk: Buffer | string): void => {
    this.buffer += chunk.toString();
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  };

  start = $hook({
    on: "start",
    handler: () => this.listen(),
  });

  stop = $hook({
    on: "stop",
    handler: () => this.release(),
  });

  /**
   * Take over stdin/stdout and begin serving.
   */
  public listen(): void {
    const proc = this.process();
    this.claimStdout(proc);
    proc.stdin.setEncoding?.("utf8");
    proc.stdin.on("data", this.onData);
    proc.stdin.resume?.();
    this.log.debug("MCP stdio transport listening");
  }

  /**
   * Stop serving and give stdout back.
   */
  public release(): void {
    const proc = this.process();
    proc.stdin.off?.("data", this.onData);
    this.restoreStdout?.();
    this.restoreStdout = undefined;
    this.stdoutWrite = undefined;
  }

  /**
   * Handle one newline-delimited message.
   */
  protected async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let response: JsonRpcResponse | null;
    try {
      const request = parseMessage(trimmed);
      const context: McpContext = { clientKey: "stdio" };
      response = await this.mcpServer.handleMessage(request, context);
    } catch (error) {
      if (!(error instanceof JsonRpcParseError)) {
        this.log.error("Failed to process MCP stdio message", error);
        return;
      }
      // `null` id, per JSON-RPC: it could not be determined.
      response = createErrorResponse(null, createParseError(error.message));
    }

    // A notification produces no output at all — not an empty line, not an
    // ack. The client is not reading for one.
    if (response) {
      this.send(response);
    }
  }

  /**
   * Write one protocol message, on its own line, to the real stdout.
   */
  protected send(message: unknown): void {
    this.stdoutWrite?.(`${JSON.stringify(message)}\n`);
  }

  /**
   * Redirect everything else's stdout to stderr, keeping the real one for
   * {@link send}.
   */
  protected claimStdout(proc: NodeProcess): void {
    if (this.restoreStdout) {
      return;
    }
    const original = proc.stdout.write.bind(proc.stdout);
    this.stdoutWrite = (chunk) => original(chunk);

    proc.stdout.write = ((chunk: any, ...rest: any[]) =>
      (proc.stderr.write as any)(chunk, ...rest)) as typeof proc.stdout.write;

    this.restoreStdout = () => {
      proc.stdout.write = original as typeof proc.stdout.write;
    };
  }

  /**
   * The host process, or a clear error.
   *
   * Resolved lazily, never at import time: `alepha/mcp` is bundled for
   * Cloudflare Workers too, and a module-level `process.stdin` would break
   * that build for everyone who only uses the HTTP transport.
   */
  protected process(): NodeProcess {
    const proc = (globalThis as { process?: NodeProcess }).process;
    if (!proc?.stdin || !proc.stdout || !proc.stderr) {
      throw new AlephaError(
        "StdioMcpTransport requires a Node-like process with stdin/stdout/stderr. " +
          "Use StreamableHttpMcpTransport on serverless runtimes.",
      );
    }
    return proc;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The slice of Node's `process` this transport needs — declared structurally
 * so the module does not depend on `@types/node` being in scope for consumers
 * that never touch stdio.
 */
interface NodeProcess {
  stdin: {
    on: (event: "data", listener: (chunk: any) => void) => void;
    off?: (event: "data", listener: (chunk: any) => void) => void;
    setEncoding?: (encoding: string) => void;
    resume?: () => void;
  };
  stdout: { write: (chunk: any, ...rest: any[]) => boolean };
  stderr: { write: (chunk: any, ...rest: any[]) => boolean };
}
