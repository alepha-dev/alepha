import { chmod, mkdir, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { InspectorDispatcher } from "../services/InspectorDispatcher.ts";
import { InspectorRegistry } from "../services/InspectorRegistry.ts";
import { InspectorRunProvider } from "./InspectorRunProvider.ts";

/**
 * Serves the inspector's route table as HTTP over a per-process Unix socket,
 * `<runDir>/<runId>.sock`, mode `0600`.
 *
 * A socket rather than a TCP port: no port to pick or collide on, no CORS, and
 * nothing reachable from the network. The unauthenticated routes that read
 * the env and write the database no longer live on the app's public port;
 * only the socket's owner can connect.
 *
 * Plain `node:http`, which Bun implements too. Every request goes through
 * `InspectorDispatcher`, so the socket validates input and serializes output
 * exactly as the specs exercise it.
 */
export class InspectorSocketServer {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly registry = $inject(InspectorRegistry);
  protected readonly run = $inject(InspectorRunProvider);
  protected readonly dispatcher = $inject(InspectorDispatcher);

  protected readonly platform: NodeJS.Platform = process.platform;

  /**
   * The longest socket path the platform accepts, in bytes: `sun_path` is 104
   * bytes on macOS and the BSDs, 108 on Linux, NUL terminator included.
   */
  protected get maxPathBytes(): number {
    return this.platform === "linux" ? 107 : 103;
  }

  /**
   * Request bodies are JSON edits from a developer tool: a megabyte is
   * generous, and a bound keeps one bad client from filling the heap.
   */
  protected readonly maxBodyBytes = 1024 * 1024;

  protected server?: Server;

  /**
   * The socket's absolute path while it is listening.
   */
  public path?: string;

  public get listening(): boolean {
    return this.path !== undefined;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.listen();
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.close();
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  protected async listen(): Promise<void> {
    if (this.platform === "win32") {
      // Out of scope, like workerd: no Unix socket, and no fallback transport.
      this.log.debug("Inspector disabled on Windows");
      return;
    }

    if (this.alepha.isTest() && !this.registry.explicitDirectory) {
      // A test that opted into the inspector still never announces itself in
      // the developer's real run directory: devtools would list every suite.
      this.log.debug(
        "Inspector socket skipped under test without ALEPHA_RUN_DIR",
      );
      return;
    }

    const dir = this.registry.directory();
    const path = this.fs.join(dir, `${this.run.runId}.sock`);

    if (Buffer.byteLength(path) > this.maxPathBytes) {
      this.log.error(
        `Inspector socket path is too long for ${this.platform} (${Buffer.byteLength(path)} > ${this.maxPathBytes} bytes): ${path}. Set ALEPHA_RUN_DIR to a shorter directory. This app will not be visible to devtools.`,
      );
      return;
    }

    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // A socket file left behind by a process that died without unlinking
      // it makes `listen` fail with EADDRINUSE. The run id is fresh, so
      // whatever sits at this path is stale by construction.
      await rm(path, { force: true });

      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => {
          server.off("error", reject);
          resolve();
        });
      });
      // The directory is already `0700`, which alone keeps other users out;
      // the socket's own mode says the same thing on its own.
      await chmod(path, 0o600);

      this.server = server;
      this.path = path;
      this.log.debug("Inspector listening", { path });
    } catch (error) {
      this.log.warn("Could not open the inspector socket", { path, error });
    }
  }

  protected async close(): Promise<void> {
    const server = this.server;
    const path = this.path;
    this.server = undefined;
    this.path = undefined;

    if (server) {
      // Idle keep-alive connections would hold `close` open forever.
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (path) {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }

  protected async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://inspector");
      const read = await this.readBody(req);
      if ("status" in read) {
        this.send(res, read.status, { message: read.message });
        return;
      }

      const result = await this.dispatcher.dispatch({
        method: req.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: read.body,
      });

      this.send(res, result.status, result.body);
    } catch (error) {
      this.send(res, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The request body as JSON, or the status that refuses it.
   */
  protected async readBody(
    req: IncomingMessage,
  ): Promise<{ body: unknown } | { status: number; message: string }> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > this.maxBodyBytes) {
        return { status: 413, message: "Request body too large" };
      }
      chunks.push(chunk as Buffer);
    }
    if (size === 0) return { body: undefined };

    try {
      return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { status: 400, message: "Request body is not JSON" };
    }
  }

  protected send(res: ServerResponse, status: number, body: unknown): void {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }
}
